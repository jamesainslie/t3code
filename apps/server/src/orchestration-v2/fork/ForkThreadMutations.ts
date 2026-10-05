/**
 * Fork thread mutations on orchestration v2: highlights, thread dependencies,
 * snooze reminders, and continuation links.
 *
 * The orchestrator routes `thread.fork.update` and `thread.fork.internal-update`
 * to `decideForkThreadUpdate`, and calls `forkSnoozeFields` and
 * `forkCreateFields` from its own snooze and create paths. Everything lands on
 * the app thread's fork fields, so the orchestrator emits the result as a plain
 * `thread.metadata-updated`. A delivered snooze reminder also becomes a
 * `system_notice` turn item, which reaches the timeline without starting a run.
 */
import {
  type ForkThreadInternalUpdateCommand,
  type ForkThreadUpdateCommand,
  isSyncedThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  SNOOZE_REMINDER_NOTICE_TITLE,
  type ThreadDependency,
  type ThreadId,
  TurnItemId,
  applyThreadDependenciesRemoved,
  applyThreadDependencyAdded,
  applyThreadDependencySatisfied,
  unsatisfiedThreadDependencies,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export type ForkThreadCommand = ForkThreadUpdateCommand | ForkThreadInternalUpdateCommand;

export interface ForkMutationDeps {
  readonly now: DateTime.Utc;
  /** Another thread, or null when it does not exist. */
  readonly getThread: (threadId: ThreadId) => Effect.Effect<OrchestrationV2AppThread | null>;
  /** Work that must not be parked out of sight: a pending request or a queued run. */
  readonly hasBlockingWork: (threadId: ThreadId) => Effect.Effect<boolean>;
  readonly nextTurnItemOrdinal: Effect.Effect<number>;
}

export interface ForkMutationOutcome {
  readonly thread: OrchestrationV2AppThread;
  /** The delivered snooze note, written to the timeline before the thread update. */
  readonly notice: OrchestrationV2TurnItem | null;
}

/** Why a fork mutation was refused; the orchestrator raises it as a dispatch error. */
export class ForkMutationRejected extends Data.TaggedError("ForkMutationRejected")<{
  readonly reason: string;
}> {}

const reject = (reason: string) => Effect.fail(new ForkMutationRejected({ reason }));

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

/**
 * True when `blockedThreadId` waiting on `dependsOnThreadId` would let a thread
 * wait on itself through unsatisfied links. Reads only the threads on the
 * chain, so it never loads the whole environment.
 */
const wouldCycle = Effect.fn("fork.dependencies.wouldCycle")(function* (
  blockedThreadId: ThreadId,
  dependsOnThreadId: ThreadId,
  getThread: ForkMutationDeps["getThread"],
) {
  const visited = new Set<ThreadId>();
  const stack: ThreadId[] = [dependsOnThreadId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockedThreadId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const thread = yield* getThread(current);
    if (thread === null) continue;
    for (const link of unsatisfiedThreadDependencies(thread)) stack.push(link.threadId);
  }
  return false;
});

/** The pending snooze note as a timeline notice, when the thread still holds one. */
const reminderNotice = Effect.fn("fork.snoozeReminder.notice")(function* (
  thread: OrchestrationV2AppThread,
  commandId: string,
  deps: ForkMutationDeps,
) {
  const reminder = thread.snoozeReminder ?? null;
  if (reminder === null || reminder.length === 0) return null;
  const notice: OrchestrationV2TurnItem = {
    id: TurnItemId.make(`turn-item:snooze-reminder:${commandId}`),
    threadId: thread.id,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: yield* deps.nextTurnItemOrdinal,
    status: "completed",
    title: SNOOZE_REMINDER_NOTICE_TITLE,
    // When the note was written; the timeline shows it beside the note.
    startedAt: thread.snoozedAt ?? deps.now,
    completedAt: deps.now,
    updatedAt: deps.now,
    type: "system_notice",
    message: reminder,
  };
  return notice;
});

/** A thread waits for a time or for other threads, never both: linking wakes it. */
function wake(thread: OrchestrationV2AppThread, now: DateTime.Utc): OrchestrationV2AppThread {
  if (thread.snoozedUntil == null) return thread;
  return { ...thread, snoozedUntil: null, snoozedAt: null, updatedAt: now };
}

export const decideForkThreadUpdate = Effect.fn("fork.thread.decide")(function* (
  command: ForkThreadCommand,
  thread: OrchestrationV2AppThread,
  deps: ForkMutationDeps,
): Effect.fn.Return<ForkMutationOutcome, ForkMutationRejected> {
  const { now } = deps;
  const update = command.update;
  switch (update.kind) {
    case "highlight.set": {
      // Cosmetic and orthogonal to lifecycle; keeping updatedAt keeps lists in place.
      return { thread: { ...thread, highlightColor: update.color }, notice: null };
    }
    case "dependency.add": {
      if (thread.archivedAt !== null) {
        return yield* reject(`Thread ${thread.id} is archived.`);
      }
      if (update.dependsOnThreadId === thread.id) {
        return yield* reject(`Thread ${thread.id} cannot depend on itself.`);
      }
      const dependency = yield* deps.getThread(update.dependsOnThreadId);
      if (dependency === null || dependency.deletedAt !== null) {
        return yield* reject(`Thread ${update.dependsOnThreadId} does not exist.`);
      }
      // Waiting on a thread that can never finish a run here is a wait that never ends:
      // archived threads do not run, and synced threads belong to another environment.
      if (dependency.archivedAt !== null) {
        return yield* reject(
          `Thread ${thread.id} cannot depend on archived thread ${dependency.id}.`,
        );
      }
      if (isSyncedThreadId(dependency.id) || isSyncedThreadId(thread.id)) {
        return yield* reject("Synced threads cannot take part in a dependency.");
      }
      if (yield* wouldCycle(thread.id, dependency.id, deps.getThread)) {
        return yield* reject(
          `Thread ${thread.id} depending on ${dependency.id} would form a cycle.`,
        );
      }
      // Same guards as snooze: blocked-on-you work must not be parked out of sight.
      if (yield* deps.hasBlockingWork(thread.id)) {
        return yield* reject(
          `Thread ${thread.id} has a pending request or queued run and cannot wait on another thread.`,
        );
      }
      // Re-adding an open link is a duplicate: keep the original linkedAt and updatedAt.
      const existing = (thread.dependencies ?? []).find(
        (link) => link.threadId === dependency.id && link.satisfiedAt === null,
      );
      const dependencies = applyThreadDependencyAdded(thread.dependencies, {
        dependsOnThreadId: dependency.id,
        linkedAt: existing?.linkedAt ?? iso(now),
      });
      const notice =
        thread.snoozedUntil == null ? null : yield* reminderNotice(thread, command.commandId, deps);
      const linked: OrchestrationV2AppThread = {
        ...thread,
        dependencies,
        updatedAt: existing === undefined ? now : thread.updatedAt,
      };
      const woken = wake(linked, now);
      return {
        thread: notice === null ? woken : { ...woken, snoozeReminder: null },
        notice,
      };
    }
    case "dependency.remove": {
      // Ids that are not linked change nothing, and updatedAt only moves when a link goes.
      const linked = new Set((thread.dependencies ?? []).map((link) => link.threadId));
      const changed = update.dependsOnThreadIds.some((id) => linked.has(id));
      return {
        thread: {
          ...thread,
          dependencies: applyThreadDependenciesRemoved(thread.dependencies, update),
          updatedAt: changed ? now : thread.updatedAt,
        },
        notice: null,
      };
    }
    case "dependency.satisfy": {
      const open = unsatisfiedThreadDependencies(thread).some(
        (link) => link.threadId === update.dependsOnThreadId,
      );
      if (!open) return { thread, notice: null };
      const dependencies: ReadonlyArray<ThreadDependency> = applyThreadDependencySatisfied(
        thread.dependencies,
        update,
      );
      return { thread: { ...thread, dependencies, updatedAt: now }, notice: null };
    }
    case "snooze-reminder.deliver": {
      // A thread snoozed into the future keeps its note for that snooze. Anything else
      // (an elapsed timer, a wake, a pin, a message) has ended the snooze, so the note lands.
      const stillSnoozed =
        thread.snoozedUntil != null &&
        DateTime.toEpochMillis(thread.snoozedUntil) > DateTime.toEpochMillis(now);
      if (stillSnoozed) return { thread, notice: null };
      const notice = yield* reminderNotice(thread, command.commandId, deps);
      if (notice === null) return { thread, notice: null };
      return { thread: { ...thread, snoozeReminder: null }, notice };
    }
  }
});

/**
 * Fork fields for `thread.snooze`. The note in effect after the snooze: absent keeps the
 * note of a pending snooze (preset re-snoozes must not drop it), "" clears it, anything
 * else replaces it. A thread waits for a time or for other threads, never both, so
 * snoozing drops its open links.
 */
export function forkSnoozeFields(
  thread: OrchestrationV2AppThread,
  command: { readonly reminder?: string | undefined },
): Pick<OrchestrationV2AppThread, "snoozeReminder" | "dependencies"> {
  const pending = thread.snoozedUntil != null ? (thread.snoozeReminder ?? null) : null;
  const reminder = command.reminder === undefined ? pending : command.reminder || null;
  return {
    snoozeReminder: reminder,
    dependencies: (thread.dependencies ?? []).filter((link) => link.satisfiedAt !== null),
  };
}

/**
 * Fork fields for `thread.settle` and `thread.pin`. Both put the thread back in the user's
 * hands, which a wait would immediately override, so its links go the way a snooze does.
 */
export function forkClearedDependencies(
  thread: Pick<OrchestrationV2AppThread, "dependencies">,
): Partial<Pick<OrchestrationV2AppThread, "dependencies">> {
  return (thread.dependencies ?? []).length === 0 ? {} : { dependencies: [] };
}

/**
 * Fork fields for `thread.create`. The continuation link is dropped when its source is
 * missing or deleted, so a new thread never points at nothing.
 */
export const forkCreateFields = Effect.fn("fork.thread.createFields")(function* (
  command: { readonly continuedFromThreadId?: ThreadId | undefined },
  getThread: ForkMutationDeps["getThread"],
) {
  if (command.continuedFromThreadId === undefined) return {};
  const source = yield* getThread(command.continuedFromThreadId);
  return source === null || source.deletedAt !== null
    ? {}
    : { continuedFromThreadId: command.continuedFromThreadId };
});
