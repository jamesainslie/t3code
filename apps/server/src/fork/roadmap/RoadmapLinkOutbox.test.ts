import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapActor,
  type RoadmapCommand,
  RoadmapError,
  RoadmapItemId,
  ThreadId,
} from "@lathe/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as RoadmapLink from "./RoadmapLink.ts";
import * as RoadmapLinkOutbox from "./RoadmapLinkOutbox.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";

const LAPTOP = EnvironmentId.make("env-laptop");
const agent: RoadmapActor = {
  _tag: "agent",
  thread: { environmentId: LAPTOP, threadId: ThreadId.make("thread-1") },
  threadTitle: "Fix the build",
};

const create = (itemId: string): RoadmapCommand => ({
  type: "roadmap.item.create",
  commandId: CommandId.make(`create-${itemId}`),
  itemId: RoadmapItemId.make(itemId),
  itemType: "story",
  title: `Story ${itemId}`,
});

/** The laptop's side: its own database, a link to the in-process home, and the outbox. */
const makeLinkedOutbox = Effect.fn("makeLinkedOutbox")(function* (
  home: RoadmapLinkTestkit.InProcessHome,
) {
  const memory = RoadmapLinkTestkit.makeMemorySecretStore();
  const services = yield* Layer.build(
    RoadmapLinkOutbox.layer.pipe(
      Layer.provideMerge(
        RoadmapLink.layer.pipe(
          Layer.provide(Layer.succeed(ServerSecretStore.ServerSecretStore, memory.store)),
          Layer.provide(RoadmapLinkTestkit.layerHttpClientTo(home)),
        ),
      ),
      Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
    ),
  );
  const link = Context.get(services, RoadmapLink.RoadmapLink);
  yield* link.configure({
    homeUrl: RoadmapLinkTestkit.HOME_URL,
    credential: yield* home.linkGrant(LAPTOP),
  });
  return { outbox: Context.get(services, RoadmapLinkOutbox.RoadmapLinkOutbox), link };
});

/** Runs the queue until it has nothing it can send, returning each step's outcome. */
const drain = (outbox: RoadmapLinkOutbox.RoadmapLinkOutbox["Service"]) =>
  Effect.gen(function* () {
    const steps: Array<string> = [];
    while (true) {
      const step = yield* outbox.runOnce;
      if (step === "idle" || step === "unlinked") return steps;
      steps.push(step);
      if (step === "retry") return steps;
    }
  });

const createdSequence = (home: RoadmapLinkTestkit.InProcessHome, itemId: string) =>
  home.roadmap
    .item(RoadmapItemId.make(itemId))
    .pipe(Effect.map((read) => read.history.map((entry) => entry.sequence)));

describe("RoadmapLinkOutbox", () => {
  it.effect("sends queued writes to the home in the order they were made", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox } = yield* makeLinkedOutbox(home);
      for (const itemId of ["c", "a", "b"]) yield* outbox.enqueue(create(itemId), agent);
      expect(yield* outbox.counts).toEqual({ queued: 3, rejected: 0 });

      expect(yield* drain(outbox)).toEqual(["sent", "sent", "sent"]);

      const [c] = yield* createdSequence(home, "c");
      const [a] = yield* createdSequence(home, "a");
      const [b] = yield* createdSequence(home, "b");
      expect(c! < a! && a! < b!).toBe(true);
      expect(yield* outbox.counts).toEqual({ queued: 0, rejected: 0 });
    }).pipe(Effect.scoped),
  );

  it.effect("holds the whole queue behind a head the home cannot be reached for", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox, link } = yield* makeLinkedOutbox(home);
      yield* outbox.enqueue(create("first"), agent);
      yield* outbox.enqueue(create("second"), agent);
      home.setReachable(false);

      expect(yield* drain(outbox)).toEqual(["retry"]);
      expect(yield* drain(outbox)).toEqual(["retry"]);
      expect(yield* outbox.counts).toEqual({ queued: 2, rejected: 0 });
      expect((yield* link.status).unreachableSince).not.toBeNull();
      // Every attempt was the head; nothing behind it went first.
      expect(home.paths.filter((path) => path === "/api/roadmap/dispatch")).toHaveLength(2);

      home.setReachable(true);
      expect(yield* drain(outbox)).toEqual(["sent", "sent"]);
      const [first] = yield* createdSequence(home, "first");
      const [second] = yield* createdSequence(home, "second");
      expect(first! < second!).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("ends only the row the home refuses, and keeps the refusal", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox } = yield* makeLinkedOutbox(home);
      const refused: RoadmapCommand = {
        type: "roadmap.item.update",
        commandId: CommandId.make("update-missing"),
        itemId: RoadmapItemId.make("missing"),
        patch: { title: "Renamed" },
      };
      yield* outbox.enqueue(refused, agent);
      yield* outbox.enqueue(create("after"), agent);

      expect(yield* drain(outbox)).toEqual(["rejected", "sent"]);
      expect(yield* outbox.counts).toEqual({ queued: 0, rejected: 1 });
      expect(Option.isSome(yield* home.roadmap.get(RoadmapItemId.make("after")))).toBe(true);

      // Queueing the refused command again answers with the recorded refusal at once.
      const again = yield* outbox.submit(refused, agent, Duration.zero);
      expect(again).toMatchObject({ _tag: "rejected", error: { code: "not_found" } });
      expect(yield* outbox.counts).toEqual({ queued: 0, rejected: 1 });
    }).pipe(Effect.scoped),
  );

  it.effect("applies a write once when the home applied it but its answer was lost", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox } = yield* makeLinkedOutbox(home);
      yield* outbox.enqueue(create("once"), agent);
      home.dropNextResponses(1);

      expect(yield* drain(outbox)).toEqual(["retry"]);
      expect(Option.isSome(yield* home.roadmap.get(RoadmapItemId.make("once")))).toBe(true);
      expect(yield* drain(outbox)).toEqual(["sent"]);
      expect(yield* createdSequence(home, "once")).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.effect("answers a write the home takes in time, and queues one it does not", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox } = yield* makeLinkedOutbox(home);
      yield* RoadmapLinkOutbox.runWorker.pipe(
        Effect.provideService(RoadmapLinkOutbox.RoadmapLinkOutbox, outbox),
        Effect.forkScoped,
      );
      expect(yield* outbox.submit(create("answered"), agent, Duration.hours(1))).toMatchObject({
        _tag: "accepted",
        result: { itemId: "answered" },
      });

      home.setReachable(false);
      expect(yield* outbox.submit(create("later"), agent, Duration.zero)).toEqual({
        _tag: "queued",
      });
      expect(yield* outbox.counts).toEqual({ queued: 1, rejected: 0 });
    }).pipe(Effect.scoped),
  );
});

describe("RoadmapLinkOutbox waiting writes", () => {
  it.effect("hear they are queued as soon as a try at the home fails", () =>
    Effect.gen(function* () {
      const home = yield* RoadmapLinkTestkit.makeInProcessHome();
      const { outbox } = yield* makeLinkedOutbox(home);
      yield* RoadmapLinkOutbox.runWorker.pipe(
        Effect.provideService(RoadmapLinkOutbox.RoadmapLinkOutbox, outbox),
        Effect.forkScoped,
      );
      home.setReachable(false);
      // An hour's wait under the test clock never runs out; only the failed try ends it.
      expect(yield* outbox.submit(create("first"), agent, Duration.hours(1))).toEqual({
        _tag: "queued",
      });
      expect(yield* outbox.submit(create("second"), agent, Duration.hours(1))).toEqual({
        _tag: "queued",
      });
      expect(yield* outbox.counts).toEqual({ queued: 2, rejected: 0 });
    }).pipe(Effect.scoped),
  );
});

describe("RoadmapLinkOutbox worker", () => {
  it("backs off exponentially from a second to a minute", () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7, 20].map(RoadmapLinkOutbox.retryDelay).map(Duration.toSeconds),
    ).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it.effect("retries an unreachable home on that schedule until it answers", () =>
    Effect.gen(function* () {
      const attempts: Array<number> = [];
      const failures = 4;
      const link = RoadmapLink.RoadmapLink.of({
        isLinked: Effect.succeed(true),
        status: Effect.succeed({ homeUrl: RoadmapLinkTestkit.HOME_URL, unreachableSince: null }),
        configure: () => Effect.void,
        snapshot: Effect.die("unused"),
        item: () => Effect.die("unused"),
        threadContext: () => Effect.die("unused"),
        dispatch: (command) =>
          Effect.gen(function* () {
            attempts.push(yield* Clock.currentTimeMillis);
            if (attempts.length <= failures) {
              return yield* new RoadmapLink.RoadmapLinkUnavailableError({ reason: "unreachable" });
            }
            return {
              sequence: 1,
              itemId: command.type === "roadmap.item.create" ? command.itemId : null,
            };
          }),
      });
      const services = yield* Layer.build(
        RoadmapLinkOutbox.layer.pipe(
          Layer.provide(Layer.succeed(RoadmapLink.RoadmapLink, link)),
          Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
        ),
      );
      const outbox = Context.get(services, RoadmapLinkOutbox.RoadmapLinkOutbox);
      yield* RoadmapLinkOutbox.runWorker.pipe(Effect.provideContext(services), Effect.forkScoped);
      // The writer hears "queued" after the first failure; the worker keeps going.
      expect(yield* outbox.submit(create("eventually"), agent, Duration.hours(1))).toEqual({
        _tag: "queued",
      });

      // The test clock runs each woken retry until the worker waits again.
      yield* TestClock.adjust("1 minute");

      expect(attempts).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
      expect(yield* outbox.counts).toEqual({ queued: 0, rejected: 0 });
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a refused row without waiting and moves to the next", () =>
    Effect.gen(function* () {
      const sent: Array<string> = [];
      const link = RoadmapLink.RoadmapLink.of({
        isLinked: Effect.succeed(true),
        status: Effect.succeed({ homeUrl: RoadmapLinkTestkit.HOME_URL, unreachableSince: null }),
        configure: () => Effect.void,
        snapshot: Effect.die("unused"),
        item: () => Effect.die("unused"),
        threadContext: () => Effect.die("unused"),
        dispatch: (command) =>
          Effect.gen(function* () {
            sent.push(command.commandId);
            if (command.commandId === "create-refused") {
              return yield* new RoadmapError({ code: "already_exists", message: "Taken." });
            }
            return { sequence: sent.length, itemId: null };
          }),
      });
      const services = yield* Layer.build(
        RoadmapLinkOutbox.layer.pipe(
          Layer.provide(Layer.succeed(RoadmapLink.RoadmapLink, link)),
          Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
        ),
      );
      const outbox = Context.get(services, RoadmapLinkOutbox.RoadmapLinkOutbox);
      yield* RoadmapLinkOutbox.runWorker.pipe(Effect.provideContext(services), Effect.forkScoped);
      yield* outbox.enqueue(create("refused"), agent);
      const next = yield* outbox
        .submit(create("next"), agent, Duration.hours(1))
        .pipe(Effect.forkChild);
      expect(yield* Fiber.join(next)).toMatchObject({ _tag: "accepted" });
      expect(sent).toEqual(["create-refused", "create-next"]);
      expect(yield* outbox.counts).toEqual({ queued: 0, rejected: 1 });
    }).pipe(Effect.scoped),
  );
});
