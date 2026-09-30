import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProviderInstanceId,
  SNOOZE_REMINDER_ACTIVITY_KIND,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";

import { ServerConfig } from "../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ServerActivation } from "../serverActivation.ts";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "./ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "./ThreadPlanProgress.ts";
import * as ThreadSnoozeReminderReactor from "./ThreadSnoozeReminderReactor.ts";

const NOW = "2026-09-30T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("snooze-reminder-project");

const at = (offsetMs: number) =>
  DateTime.formatIso(DateTime.add(DateTime.makeUnsafe(NOW), { milliseconds: offsetMs }));

const makeHarness = (options: { readonly failingThreadIds?: ReadonlyArray<ThreadId> } = {}) =>
  Effect.gen(function* () {
    const activation = yield* Deferred.make<void>();
    // One entry per reactor read of pending reminders, so tests can wait for
    // a sweep to start before draining it.
    const sweeps = yield* Queue.unbounded<void>();
    const warnings: Array<string> = [];
    const logger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") {
        warnings.push(String(Array.isArray(message) ? message[0] : message));
      }
    });
    let uuid = 0;
    const crypto = Crypto.make({
      randomBytes: (size) => new Uint8Array(size).fill(++uuid % 256),
      digest: (_algorithm, data) => Effect.succeed(data),
    });

    const orchestration = Layer.mergeAll(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationProjectionPipelineLive),
      ),
      OrchestrationProjectionSnapshotQueryLive,
    ).pipe(
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(SqlitePersistenceMemory),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-snooze-reminder-reactor-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    );

    // The reactor sees the real engine and projection, observed and with
    // delivery failing for selected threads.
    const reactorDependencies = Layer.mergeAll(
      Layer.effect(
        ProjectionSnapshotQuery,
        Effect.map(Effect.service(ProjectionSnapshotQuery), (snapshots) => ({
          ...snapshots,
          listPendingSnoozeReminders: () =>
            Queue.offer(sweeps, undefined).pipe(
              Effect.andThen(snapshots.listPendingSnoozeReminders()),
            ),
        })),
      ),
      Layer.effect(
        OrchestrationEngineService,
        Effect.map(Effect.service(OrchestrationEngineService), (engine) => ({
          ...engine,
          dispatch: (command, dispatchOptions) =>
            command.type === "thread.snooze-reminder.deliver" &&
            options.failingThreadIds?.includes(command.threadId)
              ? Effect.die(new Error(`delivery failed for ${command.threadId}`))
              : engine.dispatch(command, dispatchOptions),
        })),
      ),
      Layer.succeed(Crypto.Crypto, crypto),
      Logger.layer([logger], { mergeWithExisting: false }),
    );

    const layer = ThreadSnoozeReminderReactor.layer.pipe(
      Layer.provide(reactorDependencies),
      Layer.provideMerge(orchestration),
      Layer.provideMerge(Layer.succeed(ServerActivation, Deferred.await(activation))),
    );

    return { activation, sweeps, warnings, layer };
  });

type Harness = Effect.Success<ReturnType<typeof makeHarness>>;

const createThreads = Effect.fn("createThreads")(function* (threadIds: ReadonlyArray<ThreadId>) {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("snooze-reminder-project-create"),
    projectId: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/tmp/snooze-reminder-project",
    createdAt: NOW,
  });
  for (const threadId of threadIds) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create-${threadId}`),
      threadId,
      projectId: PROJECT_ID,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    });
  }
});

let snoozeCount = 0;
const snooze = Effect.fn("snooze")(function* (
  threadId: ThreadId,
  snoozedUntil: string,
  reminder: string,
) {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "thread.snooze",
    commandId: CommandId.make(`snooze-${threadId}-${++snoozeCount}`),
    threadId,
    snoozedUntil,
    reminder,
  });
});

const reminderActivities = Effect.fn("reminderActivities")(function* (threadId: ThreadId) {
  const snapshots = yield* ProjectionSnapshotQuery;
  const thread = Option.getOrThrow(yield* snapshots.getThreadDetailById(threadId));
  return thread.activities
    .filter((activity) => activity.kind === SNOOZE_REMINDER_ACTIVITY_KIND)
    .map((activity) => activity.summary);
});

const pendingReminder = Effect.fn("pendingReminder")(function* (threadId: ThreadId) {
  const snapshots = yield* ProjectionSnapshotQuery;
  const thread = Option.getOrThrow(yield* snapshots.getThreadShellById(threadId));
  return thread.snoozeReminder ?? null;
});

/** Starts the reactor, releases activation, and waits out the startup sweep. */
const start = Effect.fn("startSnoozeReminderReactor")(function* (harness: Harness) {
  const reactor = yield* ThreadSnoozeReminderReactor.ThreadSnoozeReminderReactor;
  yield* reactor.start();
  yield* Deferred.succeed(harness.activation, undefined);
  yield* Queue.take(harness.sweeps);
  yield* reactor.drain;
  return reactor;
});

/** Waits for the next sweep, however it was triggered, to finish. */
const nextSweep = Effect.fn("nextSweep")(function* (harness: Harness) {
  const reactor = yield* ThreadSnoozeReminderReactor.ThreadSnoozeReminderReactor;
  yield* Queue.take(harness.sweeps);
  yield* reactor.drain;
});

describe("ThreadSnoozeReminderReactor", () => {
  it.effect("delivers a reminder whose wake time passed while the server was down", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const harness = yield* makeHarness();
      const threadId = ThreadId.make("overdue");
      yield* Effect.gen(function* () {
        yield* createThreads([threadId]);
        yield* snooze(threadId, at(60_000), "Check the deploy");
        yield* TestClock.adjust("2 minutes");

        yield* start(harness);

        assert.deepStrictEqual(yield* reminderActivities(threadId), ["Check the deploy"]);
        assert.strictEqual(yield* pendingReminder(threadId), null);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("waits for a future wake time and does not deliver twice", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const harness = yield* makeHarness();
      const threadId = ThreadId.make("future");
      yield* Effect.gen(function* () {
        yield* createThreads([threadId]);
        yield* snooze(threadId, at(30_000), "Reply to review");

        yield* start(harness);
        assert.deepStrictEqual(yield* reminderActivities(threadId), []);
        yield* TestClock.adjust("29 seconds");
        assert.deepStrictEqual(yield* reminderActivities(threadId), []);

        yield* TestClock.adjust("1 second");
        yield* nextSweep(harness);
        assert.deepStrictEqual(yield* reminderActivities(threadId), ["Reply to review"]);

        // The backstop sweep a minute later finds nothing left to deliver.
        yield* TestClock.adjust("1 minute");
        yield* nextSweep(harness);
        assert.deepStrictEqual(yield* reminderActivities(threadId), ["Reply to review"]);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("re-plans on a snooze so a wake sooner than the backstop lands on time", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const harness = yield* makeHarness();
      const threadId = ThreadId.make("snoozed-later");
      yield* Effect.gen(function* () {
        yield* createThreads([threadId]);
        yield* start(harness);

        yield* snooze(threadId, at(10_000), "Look at the logs");
        yield* nextSweep(harness);
        assert.deepStrictEqual(yield* reminderActivities(threadId), []);

        yield* TestClock.adjust("10 seconds");
        yield* nextSweep(harness);
        assert.deepStrictEqual(yield* reminderActivities(threadId), ["Look at the logs"]);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps delivering other threads when one delivery fails", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const broken = ThreadId.make("broken");
      const first = ThreadId.make("first");
      const last = ThreadId.make("last");
      const harness = yield* makeHarness({ failingThreadIds: [broken] });
      yield* Effect.gen(function* () {
        yield* createThreads([first, broken, last]);
        yield* snooze(first, at(10_000), "First note");
        yield* snooze(broken, at(20_000), "Broken note");
        yield* snooze(last, at(30_000), "Last note");
        yield* TestClock.adjust("1 minute");

        yield* start(harness);

        assert.deepStrictEqual(yield* reminderActivities(first), ["First note"]);
        assert.deepStrictEqual(yield* reminderActivities(broken), []);
        assert.deepStrictEqual(yield* reminderActivities(last), ["Last note"]);
        assert.strictEqual(yield* pendingReminder(broken), "Broken note");
        assert.deepStrictEqual(harness.warnings, ["snooze reminder delivery failed"]);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );
});
