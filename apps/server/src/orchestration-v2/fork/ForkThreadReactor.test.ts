import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { Scheduler } from "../../scheduling/Scheduler.ts";
import * as Orchestrator from "../Orchestrator.ts";
import { dependencySatisfiedReason, indexThread, make } from "./ForkThreadReactor.ts";

const at = (iso: string) => DateTime.makeUnsafe(iso);

const thread = (
  id: string,
  fields: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread =>
  ({
    id: ThreadId.make(id),
    snoozedUntil: null,
    snoozedAt: null,
    deletedAt: null,
    ...fields,
  }) as OrchestrationV2AppThread;

const openLink = (id: string) => ({
  threadId: ThreadId.make(id),
  linkedAt: "2026-10-05T08:00:00.000Z",
  satisfiedAt: null,
  satisfiedReason: null,
});

describe("indexThread", () => {
  it("watches open links and held reminders only", () => {
    assert.isNull(indexThread(thread("a")));
    assert.isNull(
      indexThread(
        thread("a", { dependencies: [openLink("x")], deletedAt: at("2026-10-05T00:00:00Z") }),
      ),
    );
    const entry = indexThread(
      thread("a", {
        dependencies: [
          openLink("x"),
          { ...openLink("y"), satisfiedAt: "t", satisfiedReason: "archived" },
        ],
        snoozeReminder: "Note",
        snoozedAt: at("2026-10-05T09:00:00.000Z"),
        snoozedUntil: at("2026-10-06T09:00:00.000Z"),
      }),
    );
    assert.deepStrictEqual([...(entry?.dependencies.keys() ?? [])], [ThreadId.make("x")]);
    assert.strictEqual(entry?.reminder?.snoozedAt, "2026-10-05T09:00:00.000Z");
  });
});

describe("dependencySatisfiedReason", () => {
  const event = (fields: object) => fields as OrchestrationV2DomainEvent;
  it("releases waiters when a dependency finishes, fails, asks, or goes away", () => {
    assert.strictEqual(
      dependencySatisfiedReason(event({ type: "run.updated", payload: { status: "completed" } })),
      "turn-finished",
    );
    assert.strictEqual(
      dependencySatisfiedReason(event({ type: "run.updated", payload: { status: "failed" } })),
      "session-error",
    );
    assert.isNull(
      dependencySatisfiedReason(event({ type: "run.updated", payload: { status: "running" } })),
    );
    assert.strictEqual(
      dependencySatisfiedReason(
        event({ type: "runtime-request.updated", payload: { status: "pending" } }),
      ),
      "request-opened",
    );
    assert.strictEqual(dependencySatisfiedReason(event({ type: "thread.archived" })), "archived");
    assert.strictEqual(dependencySatisfiedReason(event({ type: "thread.deleted" })), "deleted");
  });
});

/** Runs the reactor against a mocked orchestrator and collects what it dispatches. */
const harness = (input: {
  readonly shells: ReadonlyArray<OrchestrationV2AppThread>;
  readonly expectedDispatches: number;
}) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    const dispatched = yield* Ref.make<Array<OrchestrationV2ServerCommand>>([]);
    const done = yield* Deferred.make<void>();
    const sweeps = yield* Ref.make<ReadonlyArray<Effect.Effect<void>>>([]);
    const orchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
      dispatch: (command) =>
        Ref.updateAndGet(dispatched, (all) => [...all, command]).pipe(
          Effect.tap((all) =>
            all.length >= input.expectedDispatches
              ? Deferred.succeed(done, undefined)
              : Effect.void,
          ),
          Effect.as({} as never),
        ),
      getShellSnapshot: () => Effect.succeed({ threads: input.shells } as never),
      streamDomainEvents: Stream.fromQueue(events),
    });
    const scheduler = Layer.succeed(Scheduler, {
      register: <E, R>(_name: string, run: Effect.Effect<void, E, R>) =>
        Effect.flatMap(Effect.context<R>(), (context) =>
          Ref.update(sweeps, (all) => [
            ...all,
            run.pipe(Effect.provideContext(context), Effect.ignore),
          ]),
        ),
    });
    const reactor = yield* make.pipe(Effect.provide(orchestrator));
    yield* reactor.start().pipe(Effect.provide(scheduler));
    return { events, dispatched, done, sweeps };
  });

describe("ForkThreadReactor", () => {
  it.effect("satisfies the links waiting on a thread whose run finished", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { events, dispatched, done } = yield* harness({
          shells: [
            thread("waiter-a", { dependencies: [openLink("worker")] }),
            thread("waiter-b", { dependencies: [openLink("worker"), openLink("other")] }),
            thread("bystander"),
          ],
          expectedDispatches: 2,
        });
        yield* Queue.offer(events, {
          type: "run.updated",
          threadId: ThreadId.make("worker"),
          payload: { status: "completed" },
        } as unknown as OrchestrationV2DomainEvent);
        yield* Deferred.await(done);
        const commands = yield* Ref.get(dispatched);
        assert.deepStrictEqual(
          commands.map((command) =>
            command.type === "thread.fork.internal-update" &&
            command.update.kind === "dependency.satisfy"
              ? [command.threadId, command.update.dependsOnThreadId, command.update.reason]
              : null,
          ),
          [
            [ThreadId.make("waiter-a"), ThreadId.make("worker"), "turn-finished"],
            [ThreadId.make("waiter-b"), ThreadId.make("worker"), "turn-finished"],
          ],
        );
        // Deterministic ids make a replayed event a no-op at the orchestrator.
        assert.strictEqual(
          commands[0]?.commandId,
          "fork:dependency-satisfy:waiter-a:worker:2026-10-05T08:00:00.000Z",
        );
      }),
    ),
  );

  it.effect("delivers a reminder as soon as a thread event shows its snooze ended", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const snoozedAt = at("2026-10-05T09:00:00.000Z");
        const { events, dispatched, done } = yield* harness({ shells: [], expectedDispatches: 1 });
        yield* Queue.offer(events, {
          type: "thread.unsnoozed",
          threadId: ThreadId.make("sleeper"),
          payload: thread("sleeper", { snoozeReminder: "Ship it", snoozedAt }),
        } as unknown as OrchestrationV2DomainEvent);
        yield* Deferred.await(done);
        const [command] = yield* Ref.get(dispatched);
        assert.strictEqual(command?.type, "thread.fork.internal-update");
        assert.strictEqual(
          command?.type === "thread.fork.internal-update" ? command.update.kind : null,
          "snooze-reminder.deliver",
        );
      }),
    ),
  );

  it.effect("delivers due reminders from the scheduler sweep", () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-10-05T12:00:00.000Z"));
        const { dispatched, sweeps } = yield* harness({
          shells: [
            thread("due", {
              snoozeReminder: "Due",
              snoozedAt: at("2020-01-01T00:00:00.000Z"),
              snoozedUntil: at("2020-01-02T00:00:00.000Z"),
            }),
            thread("future", {
              snoozeReminder: "Not yet",
              snoozedAt: at("2026-10-05T00:00:00.000Z"),
              snoozedUntil: at("2999-01-01T00:00:00.000Z"),
            }),
          ],
          expectedDispatches: 1,
        });
        const [sweep] = yield* Ref.get(sweeps);
        assert.isDefined(sweep);
        yield* sweep!;
        const commands = yield* Ref.get(dispatched);
        assert.deepStrictEqual(
          commands.map((command) => ("threadId" in command ? command.threadId : null)),
          [ThreadId.make("due")],
        );
      }),
    ),
  );
});
