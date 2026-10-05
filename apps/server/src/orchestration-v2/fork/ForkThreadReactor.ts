/**
 * Fork reactor for thread dependencies and snooze reminders.
 *
 * Keeps a small in-memory index of threads with open dependency links and of
 * threads holding a snooze reminder. It is seeded from the shell snapshot and
 * kept current from the domain event stream, where every thread event carries
 * the whole thread. From it:
 * - a dependency's finished run, pending request, archive, or delete satisfies
 *   the links waiting on it;
 * - a reminder whose snooze has ended, by its timer or any other way, is
 *   delivered into the chat;
 * - a message the user sends to a waiting thread ends its wait.
 * All go through fork commands with deterministic ids, so replays, restarts,
 * and races are no-ops.
 */
import {
  CommandId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type ThreadDependencySatisfiedReason,
  type ThreadId,
  unsatisfiedThreadDependencies,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { Scheduler } from "../../scheduling/Scheduler.ts";
import { forkParked } from "../../serverActivation.ts";
import * as Orchestrator from "../Orchestrator.ts";

interface IndexedThread {
  /** Open links: the thread waited on, mapped to when the link was made. */
  readonly dependencies: ReadonlyMap<ThreadId, string>;
  /** A held reminder, keyed by the snooze it belongs to. */
  readonly reminder: {
    readonly snoozedAt: string;
    readonly snoozedUntilMs: number | null;
  } | null;
}

const THREAD_EVENT_TYPES: ReadonlySet<OrchestrationV2DomainEvent["type"]> = new Set([
  "thread.created",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "thread.settled",
  "thread.unsettled",
  "thread.snoozed",
  "thread.unsnoozed",
  "thread.pinned",
  "thread.auto-settle-set",
  "thread.unpinned",
  "thread.pin-reordered",
  "thread.active-reordered",
  "thread.visited",
  "thread.marked-unread",
  "thread.metadata-updated",
  "thread.pull-request-synced",
  "thread.runtime-mode-updated",
  "thread.interaction-mode-updated",
  "thread.model-selection-updated",
  "thread.provider-switched",
]);

const iso = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.formatIso(value);

/** What the index keeps for a thread, or null when it holds nothing to watch. */
export function indexThread(
  thread: Pick<
    OrchestrationV2AppThread,
    "dependencies" | "snoozeReminder" | "snoozedAt" | "snoozedUntil" | "deletedAt"
  >,
): IndexedThread | null {
  if (thread.deletedAt != null) return null;
  const dependencies = new Map(
    unsatisfiedThreadDependencies(thread).map((link) => [link.threadId, link.linkedAt] as const),
  );
  const reminder =
    thread.snoozeReminder != null && thread.snoozeReminder.length > 0
      ? {
          snoozedAt: iso(thread.snoozedAt) ?? "none",
          snoozedUntilMs:
            thread.snoozedUntil == null ? null : DateTime.toEpochMillis(thread.snoozedUntil),
        }
      : null;
  return dependencies.size === 0 && reminder === null ? null : { dependencies, reminder };
}

/** Why a dependency event releases the threads waiting on it, if it does. */
export function dependencySatisfiedReason(
  event: OrchestrationV2DomainEvent,
): ThreadDependencySatisfiedReason | null {
  switch (event.type) {
    case "thread.archived":
      return "archived";
    case "thread.deleted":
      return "deleted";
    case "run.updated":
      switch (event.payload.status) {
        case "completed":
        case "interrupted":
        case "cancelled":
          return "turn-finished";
        case "failed":
          return "session-error";
        default:
          return null;
      }
    case "runtime-request.updated":
      return event.payload.status === "pending" ? "request-opened" : null;
    default:
      return null;
  }
}

class ForkThreadReactor extends Context.Service<
  ForkThreadReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope | Scheduler> }
>()("t3/orchestration-v2/fork/ForkThreadReactor") {}

export const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const index = yield* Ref.make(new Map<ThreadId, IndexedThread>());

  const dispatch = (command: Parameters<Orchestrator.OrchestratorV2["Service"]["dispatch"]>[0]) =>
    orchestrator.dispatch(command).pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fork thread reactor dispatch failed", {
              commandType: command.type,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const deliverReminder = (threadId: ThreadId, reminder: NonNullable<IndexedThread["reminder"]>) =>
    dispatch({
      type: "thread.fork.internal-update",
      commandId: CommandId.make(`fork:snooze-reminder:${threadId}:${reminder.snoozedAt}`),
      threadId,
      update: { kind: "snooze-reminder.deliver" },
    });

  /** Reminders whose snooze has ended, by the timer or because the thread woke early. */
  const deliverDueReminders = Effect.gen(function* () {
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const entries = yield* Ref.get(index);
    yield* Effect.forEach(
      entries,
      ([threadId, entry]) =>
        entry.reminder !== null &&
        (entry.reminder.snoozedUntilMs === null || entry.reminder.snoozedUntilMs <= nowMs)
          ? deliverReminder(threadId, entry.reminder)
          : Effect.void,
      { discard: true },
    );
  });

  const satisfyWaiters = (dependencyThreadId: ThreadId, reason: ThreadDependencySatisfiedReason) =>
    Effect.gen(function* () {
      const satisfiedAt = DateTime.formatIso(yield* DateTime.now);
      const entries = yield* Ref.get(index);
      yield* Effect.forEach(
        entries,
        ([threadId, entry]) => {
          const linkedAt = entry.dependencies.get(dependencyThreadId);
          return linkedAt === undefined
            ? Effect.void
            : dispatch({
                type: "thread.fork.internal-update",
                commandId: CommandId.make(
                  `fork:dependency-satisfy:${threadId}:${dependencyThreadId}:${linkedAt}`,
                ),
                threadId,
                update: {
                  kind: "dependency.satisfy",
                  dependsOnThreadId: dependencyThreadId,
                  reason,
                  satisfiedAt,
                },
              });
        },
        { discard: true },
      );
    });

  const processEvent = (event: OrchestrationV2DomainEvent) =>
    Effect.gen(function* () {
      if (THREAD_EVENT_TYPES.has(event.type) && "payload" in event) {
        const thread = event.payload as OrchestrationV2AppThread;
        const entry = indexThread(thread);
        yield* Ref.update(index, (current) => {
          const next = new Map(current);
          if (entry === null) next.delete(thread.id);
          else next.set(thread.id, entry);
          return next;
        });
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
        if (
          entry?.reminder != null &&
          (entry.reminder.snoozedUntilMs === null || entry.reminder.snoozedUntilMs <= nowMs)
        ) {
          yield* deliverReminder(thread.id, entry.reminder);
        }
      }
      if (
        event.type === "message.updated" &&
        event.payload.role === "user" &&
        event.payload.createdBy === "user" &&
        // Imported history has no run; only a message sent now ends a wait.
        event.payload.runId !== null
      ) {
        const open = [...((yield* Ref.get(index)).get(event.threadId)?.dependencies.keys() ?? [])];
        const [first, ...rest] = open;
        if (first !== undefined) {
          yield* dispatch({
            type: "thread.fork.update",
            commandId: CommandId.make(
              `fork:dependency-clear:${event.threadId}:${event.payload.id}`,
            ),
            threadId: event.threadId,
            update: { kind: "dependency.remove", dependsOnThreadIds: [first, ...rest] },
          });
        }
      }
      const reason = dependencySatisfiedReason(event);
      if (reason !== null) yield* satisfyWaiters(event.threadId, reason);
    });

  const start: ForkThreadReactor["Service"]["start"] = Effect.fn("ForkThreadReactor.start")(
    function* () {
      const scheduler = yield* Scheduler;
      const snapshot = yield* orchestrator.getShellSnapshot().pipe(
        Effect.map((value) => value.threads),
        Effect.orElseSucceed(() => []),
      );
      yield* Ref.set(
        index,
        new Map(
          snapshot.flatMap((shell) => {
            const entry = indexThread(shell);
            return entry === null ? [] : [[shell.id, entry] as const];
          }),
        ),
      );
      yield* scheduler.register("fork-snooze-reminders", deliverDueReminders);
      yield* forkParked(
        Stream.runForEach(orchestrator.streamDomainEvents, processEvent).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("fork thread reactor event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return ForkThreadReactor.of({ start });
});

/** Starts the reactor for the server's lifetime. */
export const workerLive = Layer.effectDiscard(Effect.flatMap(make, (reactor) => reactor.start()));
