import { CommandId, type OrchestrationEvent, type ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Delivers snooze reminders on timer wakes. Timer wakes emit no event (clients
 * derive them from the wake time), so this reactor asks the decider to write
 * the note into the timeline once the wake time passes. User and activity
 * wakes deliver the note themselves in the decider.
 */
export class ThreadSnoozeReminderReactor extends Context.Service<
  ThreadSnoozeReminderReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/ThreadSnoozeReminderReactor") {}

/** Longest wait between sweeps, a backstop for clock drift and missed events. */
const BACKSTOP_MS = 60_000;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  // Holds the one pending wake-up. Each sweep replaces it.
  const timer = yield* FiberHandle.make<void, never>();

  const deliver = Effect.fn("ThreadSnoozeReminderReactor.deliver")(
    function* (threadId: ThreadId) {
      const uuid = yield* crypto.randomUUIDv4;
      yield* engine.dispatch({
        type: "thread.snooze-reminder.deliver",
        commandId: CommandId.make(`server:snooze-reminder:${threadId}:${uuid}`),
        threadId,
      });
    },
    (effect, threadId) =>
      effect.pipe(
        // The decider rejects a deliver that has nothing to do (an activity
        // wake or a re-snooze won the race) or a thread archived meanwhile.
        // Either way there is nothing left to deliver.
        Effect.catchTag("OrchestrationCommandInvariantError", (error) =>
          Effect.logDebug("snooze reminder delivery skipped", {
            threadId,
            detail: error.detail,
          }),
        ),
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterruptsOnly(cause),
          (cause) =>
            Effect.logWarning("snooze reminder delivery failed", {
              threadId,
              cause: Cause.pretty(cause),
            }),
        ),
      ),
  );

  /** Delivers every due note and returns the earliest wake time still ahead. */
  const sweep = Effect.fn("ThreadSnoozeReminderReactor.sweep")(function* () {
    const pending = yield* snapshots.listPendingSnoozeReminders();
    const now = yield* Clock.currentTimeMillis;
    yield* Effect.forEach(
      pending.filter((entry) => Date.parse(entry.snoozedUntil) <= now),
      (entry) => deliver(entry.threadId),
      { discard: true },
    );
    return pending.find((entry) => Date.parse(entry.snoozedUntil) > now)?.snoozedUntil ?? null;
  });

  const sweepAndReschedule: Effect.Effect<void> = Effect.gen(function* () {
    // A failed sweep still reschedules, so the backstop retries it.
    const nextDue = yield* sweep().pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("snooze reminder sweep failed", { cause: Cause.pretty(cause) }).pipe(
              Effect.as(null),
            ),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    const delay = nextDue === null ? BACKSTOP_MS : Math.min(Date.parse(nextDue) - now, BACKSTOP_MS);
    yield* FiberHandle.run(
      timer,
      Effect.sleep(Duration.millis(Math.max(0, delay))).pipe(
        Effect.andThen(worker.enqueue(undefined)),
      ),
    );
  });
  const worker = yield* makeDrainableWorker<void, never, never>(() => sweepAndReschedule);

  const processEvent = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.snoozed":
      case "thread.unsnoozed":
        // The wake time or note changed, so the pending wake-up may be wrong.
        return worker.enqueue(undefined);
    }
    return Effect.void;
  };

  const start: ThreadSnoozeReminderReactor["Service"]["start"] = Effect.fn(
    "ThreadSnoozeReminderReactor.start",
  )(function* () {
    const events = yield* engine.subscribeDomainEvents;
    // The startup sweep delivers notes whose wake time passed while the
    // server was down, then schedules the next wake-up.
    yield* forkParked(worker.enqueue(undefined));
    yield* forkParked(Stream.runForEach(events, processEvent));
  });

  return { start, drain: worker.drain } satisfies ThreadSnoozeReminderReactor["Service"];
});

export const layer = Layer.effect(ThreadSnoozeReminderReactor, make);
