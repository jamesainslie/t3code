import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ModelSelection,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
  type RoadmapCommand,
  RoadmapItemId,
  type ServerSettings,
  ThreadId,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import type { DeepPartial } from "@lathe/shared/Struct";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import {
  assistantMessage,
  at,
  makeThread,
  run,
  runId,
  THREAD_ID,
  userMessage,
} from "../../mcp/toolkits/threadHistory/testFixtures.ts";
import type { HistoryThread } from "../../mcp/toolkits/threadHistory/turns.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as RoadmapLinkTestkit from "./RoadmapLink.testkit.ts";
import * as RoadmapService from "./RoadmapService.ts";
import * as RoadmapSteward from "./RoadmapSteward.ts";
import type { StewardFindings } from "./RoadmapStewardPrompt.ts";

const HOME = EnvironmentId.make("env-home");
const ELSEWHERE = EnvironmentId.make("env-laptop");
const OTHER_THREAD = ThreadId.make("thread-unattached");
const user = { _tag: "user" } as const;
const steward = { _tag: "steward", environmentId: HOME } as const;

const projection = (history: HistoryThread): OrchestrationV2ThreadProjection => ({
  ...history,
  attempts: [],
  nodes: [],
  subagents: [],
  providerSessions: [],
  providerTurns: [],
  runtimeRequests: [],
  checkpointScopes: [],
  contextHandoffs: [],
  contextTransfers: [],
  visibleTurnItems: [],
  updatedAt: at(0),
});

/** Two finished turns; the second ran the tests. Turn 2 ended at `atIso(250)`. */
const twoTurns = makeThread({
  thread: { title: "CSV export", worktreePath: "/work/export" },
  runs: [
    run({ id: runId("r1"), ordinal: 1, userMessageId: "u1" }),
    run({ id: runId("r2"), ordinal: 2, userMessageId: "u2" }),
  ],
  messages: [
    userMessage("u1", 100, "Add a CSV export button"),
    assistantMessage("a1", 140, runId("r1"), "Added the button in ReportHeader."),
    userMessage("u2", 200, "Now write tests"),
    assistantMessage("a2", 240, runId("r2"), "vp test run export.test.ts: 6 passed."),
  ],
});

const withThirdTurn = makeThread({
  ...twoTurns,
  runs: [...twoTurns.runs, run({ id: runId("r3"), ordinal: 3, userMessageId: "u3" })],
  messages: [
    ...twoTurns.messages,
    userMessage("u3", 300, "Wire the docs"),
    assistantMessage("a3", 340, runId("r3"), "Docs updated."),
  ],
});

const tickC1: StewardFindings = {
  ticks: [{ criterionId: "c1", turn: 2, evidence: "export.test.ts passed 6 tests" }],
  notes: [
    {
      kind: "unsure",
      text: "Nothing yet shows the download in a browser.",
      criterionId: "c2",
    },
  ],
};

/** What the fakes saw, and what the fake model answers. */
interface Harness {
  readonly threads: Map<ThreadId, OrchestrationV2ThreadProjection>;
  readonly prompts: Array<string>;
  readonly models: Array<ModelSelection>;
  projectionReads: number;
  snapshotReads: number;
  findings: StewardFindings;
  failNext: boolean;
  gate: {
    readonly started: Deferred.Deferred<void>;
    readonly release: Deferred.Deferred<void>;
  } | null;
}

const makeHarness = (): Harness => ({
  threads: new Map([[THREAD_ID, projection(twoTurns)]]),
  prompts: [],
  models: [],
  projectionReads: 0,
  snapshotReads: 0,
  findings: tickC1,
  failNext: false,
  gate: null,
});

const stewardOn = { roadmap: { areas: { work: { stewardEnabled: true } } } } as const;

const testLayer = (harness: Harness, settings: DeepPartial<ServerSettings> = stewardOn) => {
  const settingsLayer = ServerSettingsService.layerTest(settings);
  const identity = Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(HOME),
  });
  const roadmap = Layer.effect(
    RoadmapService.RoadmapService,
    Effect.gen(function* () {
      const service = yield* RoadmapService.RoadmapService;
      return RoadmapService.RoadmapService.of({
        ...service,
        snapshot: () =>
          Effect.suspend(() => {
            harness.snapshotReads += 1;
            return service.snapshot();
          }),
      });
    }),
  ).pipe(
    Layer.provide(
      RoadmapService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            RoadmapLinkTestkit.layerNotLinked,
            IdAllocator.layer,
            settingsLayer,
            identity,
          ),
        ),
      ),
    ),
  );
  const fakes = Layer.mergeAll(
    settingsLayer,
    identity,
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadProjection: (threadId) =>
        Effect.suspend(() => {
          harness.projectionReads += 1;
          const thread = harness.threads.get(threadId);
          return thread === undefined
            ? Effect.die(`no thread ${threadId}`)
            : Effect.succeed(thread);
        }),
      streamDomainEvents: Stream.empty,
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({}),
    Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
    Layer.mock(TextGeneration.TextGeneration)({
      generateStructured: (input) =>
        Effect.gen(function* () {
          harness.prompts.push(input.prompt);
          harness.models.push(input.modelSelection);
          if (harness.gate !== null) {
            yield* Deferred.succeed(harness.gate.started, undefined);
            yield* Deferred.await(harness.gate.release);
          }
          if (harness.failNext) {
            harness.failNext = false;
            return yield* Effect.die("model unavailable");
          }
          return harness.findings as typeof input.outputSchema.Type;
        }),
    }),
  );
  return RoadmapSteward.layer.pipe(
    Layer.provideMerge(roadmap),
    Layer.provideMerge(fakes),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  );
};

const seed = (
  attachThread: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId } = {
    environmentId: HOME,
    threadId: THREAD_ID,
  },
  area: "work" | "personal" = "work",
) =>
  Effect.gen(function* () {
    const roadmap = yield* RoadmapService.RoadmapService;
    yield* roadmap.dispatch(
      {
        type: "roadmap.item.create",
        commandId: CommandId.make(`create-${attachThread.threadId}`),
        itemId: RoadmapItemId.make(`feature-${attachThread.threadId}`),
        itemType: "feature",
        title: "Export reports as CSV",
        area,
        criteria: [
          { id: "c1", text: "Tests cover export" },
          { id: "c2", text: "Users can download a CSV" },
        ],
        attachThread,
      },
      user,
    );
    return RoadmapItemId.make(`feature-${attachThread.threadId}`);
  });

const readItem = (itemId: RoadmapItemId) =>
  Effect.gen(function* () {
    const roadmap = yield* RoadmapService.RoadmapService;
    return Option.getOrThrow(yield* roadmap.get(itemId));
  });

const runOnce = (threadId: ThreadId = THREAD_ID) =>
  Effect.gen(function* () {
    const service = yield* RoadmapSteward.RoadmapSteward;
    yield* service.notify(threadId);
    yield* service.drain;
  });

describe("RoadmapSteward", () => {
  it.effect("ticks a criterion with evidence from the turn and adds its notes", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const itemId = yield* seed();
      yield* runOnce();

      const item = yield* readItem(itemId);
      assert.deepInclude(item.criteria[0]!, {
        tickedBy: steward,
        evidence: 'Turn 2 of "CSV export": export.test.ts passed 6 tests',
      });
      assert.isNull(item.criteria[1]!.tickedAt);
      assert.deepEqual(
        item.progressNotes.map((note) => [note.kind, note.criterionId, note.actor]),
        [["unsure", "c2", steward]],
      );
      assert.lengthOf(harness.prompts, 1);
      assert.include(harness.prompts[0]!, "New turns since your last look: turn 1");
      // Without a steward model it uses the text generation model.
      assert.deepEqual(harness.models[0], DEFAULT_SERVER_SETTINGS.textGenerationModelSelection);

      // Nothing new: no second model call.
      yield* runOnce();
      assert.lengthOf(harness.prompts, 1);

      // A later turn is read alone.
      harness.threads.set(THREAD_ID, projection(withThirdTurn));
      harness.findings = { ticks: [], notes: [] };
      yield* runOnce();
      assert.lengthOf(harness.prompts, 2);
      assert.include(harness.prompts[1]!, "New turns since your last look: turn 3 (ended");
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("drops a re-tick whose evidence is older than the user's untick", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const itemId = yield* seed();
      const roadmap = yield* RoadmapService.RoadmapService;
      const tick = (commandId: string, ticked: boolean): RoadmapCommand => ({
        type: "roadmap.criterion.tick",
        commandId: CommandId.make(commandId),
        itemId,
        criterionId: "c1",
        ticked,
      });
      // The user unticks after both turns ended.
      yield* TestClock.setTime(Date.parse("2026-10-01T00:00:00.000Z"));
      yield* roadmap.dispatch(tick("user-tick", true), user);
      yield* roadmap.dispatch(tick("user-untick", false), user);

      yield* runOnce();

      const item = yield* readItem(itemId);
      assert.isNull(item.criteria[0]!.tickedAt);
      // The refusal drops only the tick; the run's note still lands.
      assert.deepEqual(
        item.progressNotes.map((note) => note.kind),
        ["unsure"],
      );
      assert.include(harness.prompts[0]!, "unticked by the user at 2026-10-01T00:00:00.000Z");
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("does not run for an area with the steward off", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const itemId = yield* seed();
      yield* runOnce();
      const service = yield* RoadmapSteward.RoadmapSteward;
      yield* service.sweep;
      yield* service.drain;

      assert.equal(harness.projectionReads, 0);
      assert.lengthOf(harness.prompts, 0);
      assert.isNull((yield* readItem(itemId)).criteria[0]!.tickedAt);
    }).pipe(Effect.provide(testLayer(harness, {})));
  });

  it.effect("runs nothing for a thread attached to no item", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seed({ environmentId: ELSEWHERE, threadId: THREAD_ID });
      // Attached on another environment: this one's steward never reads it.
      yield* runOnce(THREAD_ID);
      yield* runOnce(OTHER_THREAD);
      const service = yield* RoadmapSteward.RoadmapSteward;
      yield* service.sweep;
      yield* service.drain;

      assert.equal(harness.projectionReads, 0);
      assert.lengthOf(harness.prompts, 0);
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("coalesces a burst of turn ends on one thread into one more run", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seed();
      const gate = {
        started: yield* Deferred.make<void>(),
        release: yield* Deferred.make<void>(),
      };
      harness.gate = gate;
      const service = yield* RoadmapSteward.RoadmapSteward;

      yield* service.notify(THREAD_ID);
      yield* Deferred.await(gate.started);
      yield* service.notify(THREAD_ID);
      yield* service.notify(THREAD_ID);
      yield* service.notify(THREAD_ID);
      yield* Deferred.succeed(gate.release, undefined);
      yield* service.drain;

      // The first run, then one run for the three notices, which finds nothing new.
      assert.equal(harness.projectionReads, 2);
      assert.lengthOf(harness.prompts, 1);
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("keeps the turns for the next run when the model fails, and never fails itself", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const itemId = yield* seed();
      harness.failNext = true;
      yield* runOnce();
      assert.isNull((yield* readItem(itemId)).criteria[0]!.tickedAt);

      yield* runOnce();
      assert.lengthOf(harness.prompts, 2);
      assert.include(harness.prompts[1]!, "New turns since your last look: turn 1");
      assert.isNotNull((yield* readItem(itemId)).criteria[0]!.tickedAt);
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("sweeps once a day and catches a thread whose turn end it missed", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      const itemId = yield* seed();
      const service = yield* RoadmapSteward.RoadmapSteward;

      yield* service.sweepIfDue;
      yield* service.drain;
      assert.lengthOf(harness.prompts, 1);
      assert.isNotNull((yield* readItem(itemId)).criteria[0]!.tickedAt);

      harness.threads.set(THREAD_ID, projection(withThirdTurn));
      yield* service.sweepIfDue;
      yield* service.drain;
      assert.lengthOf(harness.prompts, 1);

      yield* TestClock.adjust("1 day");
      yield* service.sweepIfDue;
      yield* service.drain;
      assert.lengthOf(harness.prompts, 2);
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect("reads nothing when a turn ends on a thread it does not steward", () => {
    const harness = makeHarness();
    return Effect.gen(function* () {
      yield* seed();
      const service = yield* RoadmapSteward.RoadmapSteward;
      yield* service.refresh;
      yield* service.drain;
      // The refresh queued the thread it had not read before.
      assert.lengthOf(harness.prompts, 1);

      harness.snapshotReads = 0;
      yield* service.turnEnded(OTHER_THREAD);
      yield* service.drain;
      assert.equal(harness.snapshotReads, 0);

      harness.threads.set(THREAD_ID, projection(withThirdTurn));
      harness.findings = { ticks: [], notes: [] };
      yield* service.turnEnded(THREAD_ID);
      yield* service.drain;
      assert.lengthOf(harness.prompts, 2);
    }).pipe(Effect.provide(testLayer(harness)));
  });

  it.effect(
    "picks up an area as soon as its steward is turned on, and a newly attached thread",
    () => {
      const harness = makeHarness();
      const second = ThreadId.make("thread-second");
      harness.threads.set(second, projection(twoTurns));
      return Effect.gen(function* () {
        const itemId = yield* seed();
        const service = yield* RoadmapSteward.RoadmapSteward;
        yield* service.refresh;
        yield* service.drain;
        assert.lengthOf(harness.prompts, 0);

        const settings = yield* ServerSettingsService;
        yield* settings.updateSettings({ roadmap: { areas: { work: { stewardEnabled: true } } } });
        yield* service.refresh;
        yield* service.drain;
        assert.lengthOf(harness.prompts, 1);

        // A refresh with nothing new queues nothing.
        yield* service.refresh;
        yield* service.drain;
        assert.equal(harness.projectionReads, 1);

        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.dispatch(
          {
            type: "roadmap.thread.attach",
            commandId: CommandId.make("attach-second"),
            itemId,
            thread: { environmentId: HOME, threadId: second },
          },
          user,
        );
        yield* service.refresh;
        yield* service.drain;
        assert.lengthOf(harness.prompts, 2);
      }).pipe(Effect.provide(testLayer(harness, {})));
    },
  );
});

describe("isStewardTrigger", () => {
  const runUpdated = (status: string, started = true) =>
    ({
      type: "run.updated",
      threadId: THREAD_ID,
      payload: {
        ...run({ id: runId("r1"), ordinal: 1, userMessageId: "u1" }),
        status,
        startedAt: started ? at(1) : null,
      },
    }) as unknown as OrchestrationV2DomainEvent;

  it("fires when a turn ends, not while it runs or when it never started", () => {
    for (const status of ["completed", "interrupted", "failed", "cancelled"]) {
      assert.isTrue(RoadmapSteward.isStewardTrigger(runUpdated(status)), status);
    }
    for (const status of ["running", "queued", "waiting"]) {
      assert.isFalse(RoadmapSteward.isStewardTrigger(runUpdated(status)), status);
    }
    assert.isFalse(RoadmapSteward.isStewardTrigger(runUpdated("cancelled", false)));
    assert.isFalse(
      RoadmapSteward.isStewardTrigger({
        type: "thread.archived",
        threadId: THREAD_ID,
      } as unknown as OrchestrationV2DomainEvent),
    );
  });
});
