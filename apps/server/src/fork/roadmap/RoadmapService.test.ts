import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapCommand,
  RoadmapItemId,
  RoadmapSprintId,
  type RoadmapStreamItem,
  ThreadId,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";
import * as RoadmapLinkOutbox from "./RoadmapLinkOutbox.ts";
import * as RoadmapService from "./RoadmapService.ts";

const HOME = EnvironmentId.make("env-home");
const user = { _tag: "user" } as const;

const testLayer = (homeEnvironmentId: EnvironmentId | null) =>
  RoadmapService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        RoadmapLinkTestkit.layerNotLinked,
        IdAllocator.layer,
        ServerSettingsService.layerTest({ roadmap: { homeEnvironmentId } }),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(HOME),
        }),
      ),
    ),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  );

const create = (itemId: string, commandId = `cmd-${itemId}`): RoadmapCommand => ({
  type: "roadmap.item.create",
  commandId: CommandId.make(commandId),
  itemId: RoadmapItemId.make(itemId),
  itemType: "objective",
  title: `Objective ${itemId}`,
});

const countRows = (table: "roadmap_events" | "roadmap_command_receipts") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM ${sql(table)}
    `;
    return rows[0]!.count;
  });

describe("RoadmapService", () => {
  it.layer(testLayer(null))("on the roadmap home", (it) => {
    it.effect("commits the event, the item and the receipt together", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const result = yield* roadmap.dispatch(create("a"), user);
        assert.equal(result.itemId, "a");
        assert.isAbove(result.sequence, 0);
        const item = Option.getOrThrow(yield* roadmap.get(RoadmapItemId.make("a")));
        assert.equal(item.title, "Objective a");
        assert.equal(yield* countRows("roadmap_events"), 1);
        assert.equal(yield* countRows("roadmap_command_receipts"), 1);
      }),
    );

    it.effect("replays the first result for a repeated command id", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const first = yield* roadmap.dispatch(create("b"), user);
        const events = yield* countRows("roadmap_events");
        const second = yield* roadmap.dispatch(create("b"), user);
        assert.deepEqual(second, first);
        assert.equal(yield* countRows("roadmap_events"), events);
      }),
    );

    it.effect("records a rejection and writes no event", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const events = yield* countRows("roadmap_events");
        const receipts = yield* countRows("roadmap_command_receipts");
        const orphan: RoadmapCommand = {
          ...create("orphan"),
          parentId: RoadmapItemId.make("missing"),
        } as RoadmapCommand;
        const exit = yield* Effect.exit(roadmap.dispatch(orphan, user));
        assert.isTrue(Exit.isFailure(exit));
        assert.equal(yield* countRows("roadmap_events"), events);
        assert.equal(yield* countRows("roadmap_command_receipts"), receipts + 1);
        const error = yield* Effect.flip(roadmap.dispatch(orphan, user));
        assert.equal(error.code, "not_found");
      }),
    );

    it.effect("streams a snapshot, then later changes only", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.dispatch(create("before"), user);
        const subscribed = yield* Deferred.make<void>();
        const seen = yield* roadmap.stream().pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        const after = yield* roadmap.dispatch(create("after"), user);
        const removed = yield* roadmap.dispatch(
          {
            type: "roadmap.item.delete",
            commandId: CommandId.make("cmd-delete-after"),
            itemId: RoadmapItemId.make("after"),
          },
          user,
        );
        const items: ReadonlyArray<RoadmapStreamItem> = yield* Fiber.join(seen);
        const [snapshot, upserted, gone] = items;
        assert.equal(snapshot?.type, "snapshot");
        if (snapshot?.type !== "snapshot") return;
        assert.include(
          snapshot.items.map((item) => item.id),
          RoadmapItemId.make("before"),
        );
        assert.isBelow(snapshot.sequence, after.sequence);
        assert.deepInclude(upserted, { type: "item.upserted", sequence: after.sequence });
        assert.deepEqual(gone, {
          type: "item.removed",
          sequence: removed.sequence,
          itemId: RoadmapItemId.make("after"),
        });
      }),
    );

    it.effect("manages sprints, streaming them and the items a delete clears", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const sprintId = RoadmapSprintId.make("sprint-a");
        const createSprint: RoadmapCommand = {
          type: "roadmap.sprint.create",
          commandId: CommandId.make("cmd-sprint-a"),
          sprintId,
          name: "Sprint A",
          area: "work",
          startDate: "2026-10-19",
          endDate: "2026-10-30",
        };
        const created = yield* roadmap.dispatch(createSprint, user);
        assert.isNull(created.itemId);
        assert.deepEqual(yield* roadmap.dispatch(createSprint, user), created);
        yield* roadmap.dispatch(create("sprinted"), user);
        yield* roadmap.dispatch(
          {
            type: "roadmap.item.update",
            commandId: CommandId.make("cmd-assign"),
            itemId: RoadmapItemId.make("sprinted"),
            patch: { sprintId },
          },
          user,
        );

        const subscribed = yield* Deferred.make<void>();
        const seen = yield* roadmap.stream().pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        const deleted = yield* roadmap.dispatch(
          { type: "roadmap.sprint.delete", commandId: CommandId.make("cmd-sprint-del"), sprintId },
          user,
        );
        const [snapshot, ...deltas] = yield* Fiber.join(seen);
        assert.equal(snapshot?.type, "snapshot");
        if (snapshot?.type !== "snapshot") return;
        assert.deepEqual(
          snapshot.sprints.map((value) => value.id),
          [sprintId],
        );
        assert.sameDeepMembers(
          deltas.map((delta) =>
            delta.type === "sprint.removed"
              ? [delta.type, delta.sequence, delta.sprintId]
              : delta.type === "item.upserted"
                ? [delta.type, delta.sequence, delta.item.id, delta.item.sprintId]
                : [delta.type],
          ),
          [
            ["sprint.removed", deleted.sequence, sprintId],
            ["item.upserted", deleted.sequence, RoadmapItemId.make("sprinted"), null],
          ],
        );
        const item = Option.getOrThrow(yield* roadmap.get(RoadmapItemId.make("sprinted")));
        assert.isNull(item.sprintId);
        assert.deepEqual(yield* roadmap.listSprints(), []);
      }),
    );

    it.effect("refuses sprint changes from an agent", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const agent = {
          _tag: "agent",
          thread: { environmentId: HOME, threadId: ThreadId.make("t-agent") },
          threadTitle: "Agent",
        } as const;
        const error = yield* Effect.flip(
          roadmap.dispatch(
            {
              type: "roadmap.sprint.create",
              commandId: CommandId.make("cmd-agent-sprint"),
              sprintId: RoadmapSprintId.make("sprint-agent"),
              name: "Agent sprint",
              area: "work",
              startDate: "2026-10-19",
              endDate: "2026-10-30",
            },
            agent,
          ),
        );
        assert.equal(error.code, "forbidden_actor");
      }),
    );
  });

  it.layer(testLayer(HOME))("when the setting names this environment", (it) => {
    it.effect("accepts commands", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        assert.isTrue(yield* roadmap.isHome);
        yield* roadmap.dispatch(create("here"), user);
      }),
    );
  });

  it.layer(testLayer(EnvironmentId.make("env-elsewhere")))(
    "when the roadmap lives on another environment",
    (it) => {
      it.effect("refuses commands with roadmap_home_elsewhere", () =>
        Effect.gen(function* () {
          const roadmap = yield* RoadmapService.RoadmapService;
          assert.isFalse(yield* roadmap.isHome);
          const error = yield* Effect.flip(roadmap.dispatch(create("there"), user));
          assert.equal(error.code, "roadmap_home_elsewhere");
          assert.equal(yield* countRows("roadmap_events"), 0);
        }),
      );

      it.effect("refuses reads and writes while it is not linked to the home", () =>
        Effect.gen(function* () {
          const roadmap = yield* RoadmapService.RoadmapService;
          assert.equal(yield* roadmap.location, "not-linked");
          for (const refused of [
            Effect.flip(roadmap.snapshot()),
            Effect.flip(roadmap.forThread(laptopThread)),
            Effect.flip(roadmap.submit(create("there"), laptopAgent)),
          ]) {
            assert.equal((yield* refused).code, "roadmap_home_elsewhere");
          }
          assert.deepEqual(yield* roadmap.linkStatus, {
            state: "not-linked",
            homeUrl: null,
            unreachableSince: null,
            queued: 0,
            rejected: 0,
          });
        }),
      );
    },
  );
});

const LAPTOP = EnvironmentId.make("env-laptop");
const laptopThread = { environmentId: LAPTOP, threadId: ThreadId.make("thread-laptop") };
const laptopAgent = { _tag: "agent", thread: laptopThread, threadTitle: "Laptop work" } as const;

/** The home in process, and the laptop's roadmap service linked to it. */
const makeLinkedLaptop = Effect.fn("makeLinkedLaptop")(function* (
  options: { readonly link?: boolean; readonly worker?: boolean } = {},
) {
  const home = yield* RoadmapLinkTestkit.makeInProcessHome();
  const services = yield* Layer.build(
    RoadmapLinkTestkit.layerLinkedEnvironment(home, {
      environmentId: LAPTOP,
      homeEnvironmentId: EnvironmentId.make("env-home"),
    }),
  );
  const laptop = Context.get(services, RoadmapService.RoadmapService);
  if (options.worker !== false) {
    yield* RoadmapLinkOutbox.runWorker.pipe(Effect.provideContext(services), Effect.forkScoped);
  }
  if (options.link !== false) {
    yield* laptop.configureLink({
      homeUrl: RoadmapLinkTestkit.HOME_URL,
      credential: yield* home.linkGrant(LAPTOP),
    });
  }
  return {
    home,
    laptop,
    localEvents: countRows("roadmap_events").pipe(Effect.provideContext(services)),
  };
});

describe("RoadmapService off the home, linked", () => {
  it.effect("reads the home's roadmap through the link", () =>
    Effect.gen(function* () {
      const { home, laptop, localEvents } = yield* makeLinkedLaptop();
      yield* home.roadmap.dispatch(
        { ...create("attached"), attachThread: laptopThread } as RoadmapCommand,
        user,
      );
      yield* home.roadmap.dispatch(create("other"), user);

      assert.equal(yield* laptop.location, "linked");
      assert.deepEqual(
        (yield* laptop.snapshot()).items.map((item) => item.id),
        ["attached", "other"],
      );
      assert.deepEqual(
        (yield* laptop.list()).map((item) => item.id),
        ["attached", "other"],
      );
      assert.equal(
        Option.getOrThrow(yield* laptop.get(RoadmapItemId.make("other"))).title,
        "Objective other",
      );
      assert.deepEqual(
        (yield* laptop.forThread(laptopThread)).map((item) => item.id),
        ["attached"],
      );
      assert.include((yield* laptop.threadContext(laptopThread)).context, "(id attached)");
      assert.equal((yield* laptop.item(RoadmapItemId.make("attached"))).history.length, 1);
      // Nothing lands in the laptop's own tables.
      assert.equal(yield* localEvents, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("applies an agent's write on the home and answers with the home's result", () =>
    Effect.gen(function* () {
      const { home, laptop, localEvents } = yield* makeLinkedLaptop();
      const result = yield* laptop.submit(create("from-laptop"), laptopAgent);
      assert.isFalse(result.queued);
      assert.equal(result.itemId, "from-laptop");
      const item = Option.getOrThrow(yield* home.roadmap.get(RoadmapItemId.make("from-laptop")));
      assert.deepEqual(item.createdBy, laptopAgent);
      assert.equal(yield* localEvents, 0);
      // The home's refusal reaches the agent as the home's own error.
      const refused = yield* Effect.flip(
        laptop.submit(
          {
            type: "roadmap.item.update",
            commandId: CommandId.make("update-missing"),
            itemId: RoadmapItemId.make("missing"),
            patch: { title: "Renamed" },
          },
          laptopAgent,
        ),
      );
      assert.equal(refused.code, "not_found");
    }).pipe(Effect.scoped),
  );

  it.effect("queues a write while the home is unreachable and reports it queued", () =>
    Effect.gen(function* () {
      const { home, laptop } = yield* makeLinkedLaptop();
      home.setReachable(false);
      const read = yield* Effect.flip(laptop.snapshot());
      assert.equal(read.code, "internal");

      const result = yield* laptop.submit(create("later"), laptopAgent);
      assert.deepEqual(result, { queued: true, itemId: RoadmapItemId.make("later") });
      const status = yield* laptop.linkStatus;
      assert.equal(status.state, "unreachable");
      assert.equal(status.homeUrl, RoadmapLinkTestkit.HOME_URL);
      assert.equal(status.queued, 1);
      assert.isTrue(Option.isNone(yield* home.roadmap.get(RoadmapItemId.make("later"))));
    }).pipe(Effect.scoped),
  );

  it.effect("refuses writes until it is linked, and again once unlinked", () =>
    Effect.gen(function* () {
      const { home, laptop } = yield* makeLinkedLaptop({ link: false });
      // Not linked: nothing queues, so a write cannot be lost to a link that never comes.
      assert.equal(
        (yield* Effect.flip(laptop.submit(create("early"), laptopAgent))).code,
        "roadmap_home_elsewhere",
      );
      yield* laptop.configureLink({
        homeUrl: RoadmapLinkTestkit.HOME_URL,
        credential: yield* home.linkGrant(LAPTOP),
      });
      assert.isFalse((yield* laptop.submit(create("linked"), laptopAgent)).queued);
      yield* laptop.configureLink(null);
      assert.equal((yield* laptop.linkStatus).state, "not-linked");
      assert.equal(yield* laptop.location, "not-linked");
    }).pipe(Effect.scoped),
  );
});
