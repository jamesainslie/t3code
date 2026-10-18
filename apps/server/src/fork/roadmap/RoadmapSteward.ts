/**
 * Fork: roadmap. The steward relates attached threads' turns to their work
 * item's acceptance criteria. After a turn ends on a thread this environment
 * owns, and once a day for every such thread, it reads the turns since its last
 * look, asks the environment's steward model what they show, and submits ticks
 * with evidence and notes through `RoadmapService.submit`. Off the home those
 * writes queue for the home like an agent's.
 *
 * It never blocks or fails a turn: runs happen on a worker after the turn has
 * ended, and every failure is logged and dropped. The planner decides what the
 * steward may write; refusals are logged, not surfaced.
 */
import type {
  OrchestrationV2DomainEvent,
  RoadmapActor,
  RoadmapLinkSnapshot,
  RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import { makeDrainableWorker } from "@lathe/shared/DrainableWorker";
import { effectiveArea } from "@lathe/shared/roadmap";
import { resolveRoadmapStewardModelSelection } from "@lathe/shared/serverSettings";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { Scheduler } from "../../scheduling/Scheduler.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import * as RoadmapService from "./RoadmapService.ts";
import {
  buildStewardPrompt,
  criterionUntickTimes,
  stewardCommands,
  stewardDigest,
  StewardFindings,
  stewardNewTurns,
} from "./RoadmapStewardPrompt.ts";

/** Turn ends that may hold new evidence; a run that never started holds none. */
export const isStewardTrigger = (event: OrchestrationV2DomainEvent): boolean =>
  event.type === "run.updated" &&
  (event.payload.status === "completed" ||
    event.payload.status === "interrupted" ||
    event.payload.status === "failed" ||
    (event.payload.status === "cancelled" && event.payload.startedAt !== null));

export class RoadmapSteward extends Context.Service<
  RoadmapSteward,
  {
    /** Queues a run for the thread. Calls while one is queued add nothing. */
    readonly notify: (threadId: ThreadId) => Effect.Effect<void>;
    /** Queues every thread this environment owns that is attached in an area with the steward on. */
    readonly sweep: Effect.Effect<void>;
    /** Sweeps unless a sweep already ran this UTC day. */
    readonly sweepIfDue: Effect.Effect<void>;
    /** Resolves once every queued run has finished. */
    readonly drain: Effect.Effect<void>;
    /** Runs after turns end and sweeps daily, for the server's lifetime. */
    readonly start: () => Effect.Effect<void, never, Scope.Scope | Scheduler>;
  }
>()("lathe/fork/roadmap/RoadmapSteward") {}

const sameThread = (
  left: { readonly environmentId: string; readonly threadId: string },
  right: { readonly environmentId: string; readonly threadId: string },
) => left.environmentId === right.environmentId && left.threadId === right.threadId;

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettingsService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const sql = yield* SqlClient.SqlClient;

  const readCursor = (threadId: ThreadId) =>
    sql<{ readonly digestedUntil: string }>`
      SELECT digested_until AS "digestedUntil" FROM roadmap_steward_threads
      WHERE thread_id = ${threadId}
    `.pipe(Effect.map((rows) => rows[0]?.digestedUntil ?? null));

  const writeCursor = (threadId: ThreadId, digestedUntil: string) =>
    Effect.gen(function* () {
      const ranAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO roadmap_steward_threads (thread_id, digested_until, ran_at)
        VALUES (${threadId}, ${digestedUntil}, ${ranAt})
        ON CONFLICT (thread_id) DO UPDATE SET
          digested_until = excluded.digested_until,
          ran_at = excluded.ran_at
      `;
    });

  /** The roadmap as this environment sees it, or none when it has no roadmap to read. */
  const readRoadmap = Effect.gen(function* () {
    if ((yield* roadmap.location) === "not-linked") return Option.none();
    return Option.some(yield* roadmap.snapshot());
  });

  // A done item has nothing left to tick, so it costs no model call.
  const stewardOn = (item: RoadmapWorkItem, snapshot: RoadmapLinkSnapshot): boolean => {
    if (item.state === "done") return false;
    const byId = new Map(snapshot.items.map((entry) => [entry.id, entry]));
    return snapshot.areas[effectiveArea(item.id, byId).area].stewardEnabled;
  };

  const runThread = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const environmentId = yield* identity.getEnvironmentId;
      const snapshot = yield* readRoadmap;
      if (Option.isNone(snapshot)) return;
      const ref = { environmentId, threadId };
      // A thread is attached to one item at a time; see `already_attached`.
      const item = snapshot.value.items.find((entry) =>
        entry.attachments.some((attachment) => sameThread(attachment.thread, ref)),
      );
      if (item === undefined || !stewardOn(item, snapshot.value)) return;

      const thread = yield* orchestrator.getThreadProjection(threadId);
      if (thread.thread.deletedAt !== null) return;
      const newTurns = stewardNewTurns(thread, yield* readCursor(threadId));
      const newest = newTurns.at(-1);
      if (newest === undefined) return;

      const cwd =
        thread.thread.worktreePath ??
        Option.getOrUndefined(yield* projects.get(thread.thread.projectId))?.workspaceRoot;
      if (cwd === undefined) return;
      const { history } = yield* roadmap.item(item.id);
      const modelSelection = resolveRoadmapStewardModelSelection(
        yield* serverSettings.getSettings,
        yield* providerRegistry.getProviders,
      );
      const findings = yield* textGeneration.generateStructured({
        cwd,
        prompt: buildStewardPrompt({
          item,
          untickedAt: criterionUntickTimes(history),
          newTurns,
          digest: stewardDigest({ thread, projectTitle: null, newTurns: newTurns.length }),
        }),
        outputSchema: StewardFindings,
        modelSelection,
      });

      const actor: RoadmapActor = { _tag: "steward", environmentId };
      const commands = stewardCommands({
        findings,
        item,
        threadId,
        threadTitle: thread.thread.title,
        newTurns,
        runKey: newest.endedAt,
      });
      for (const command of commands) {
        yield* roadmap.submit(command, actor).pipe(
          Effect.catchTags({
            RoadmapError: (error) =>
              Effect.logInfo("roadmap steward write refused", {
                threadId,
                commandType: command.type,
                code: error.code,
              }),
          }),
        );
      }
      // Refused writes still count as read: the model would only say the same again.
      yield* writeCursor(threadId, newest.endedAt);
    }).pipe(
      Effect.withSpan("RoadmapSteward.runThread"),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("roadmap steward run failed", {
              threadId,
              // An unreachable home or a failed model call; the next turn or sweep retries.
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const pending = yield* Ref.make<ReadonlySet<ThreadId>>(new Set());
  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    Ref.update(pending, (current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    }).pipe(Effect.andThen(runThread(threadId))),
  );

  const notify: RoadmapSteward["Service"]["notify"] = (threadId) =>
    Ref.modify(pending, (current): readonly [boolean, ReadonlySet<ThreadId>] =>
      current.has(threadId) ? [false, current] : [true, new Set(current).add(threadId)],
    ).pipe(Effect.flatMap((queued) => (queued ? worker.enqueue(threadId) : Effect.void)));

  const sweep: RoadmapSteward["Service"]["sweep"] = Effect.gen(function* () {
    const snapshot = yield* readRoadmap;
    if (Option.isNone(snapshot)) return;
    const environmentId = yield* identity.getEnvironmentId;
    for (const item of snapshot.value.items) {
      if (!stewardOn(item, snapshot.value)) continue;
      for (const attachment of item.attachments) {
        if (attachment.thread.environmentId === environmentId) {
          yield* notify(attachment.thread.threadId);
        }
      }
    }
  }).pipe(
    Effect.catchTags({
      RoadmapError: (error) =>
        Effect.logInfo("roadmap steward sweep skipped", { code: error.code }),
    }),
  );

  // In memory on purpose: the first sweep after a start catches turns that
  // ended while the server was down, and the per-thread cursor keeps a repeat
  // sweep from reading any turn twice.
  const lastSweepDay = yield* Ref.make<string | null>(null);
  const sweepIfDue: RoadmapSteward["Service"]["sweepIfDue"] = Effect.gen(function* () {
    const today = DateTime.formatIsoDateUtc(yield* DateTime.now);
    if ((yield* Ref.getAndSet(lastSweepDay, today)) === today) return;
    yield* sweep;
  });

  const start: RoadmapSteward["Service"]["start"] = Effect.fn("RoadmapSteward.start")(function* () {
    const scheduler = yield* Scheduler;
    yield* scheduler.register("roadmap-steward-sweep", sweepIfDue);
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        isStewardTrigger(event) ? notify(event.threadId) : Effect.void,
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("roadmap steward event stream failed", { cause }),
        ),
      ),
    );
  });

  return RoadmapSteward.of({ notify, sweep, sweepIfDue, drain: worker.drain, start });
});

export const layer = Layer.effect(RoadmapSteward, make);

/** Starts the steward for the server's lifetime. */
export const workerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const steward = yield* RoadmapSteward;
    yield* steward.start();
  }),
).pipe(Layer.provide(layer));
