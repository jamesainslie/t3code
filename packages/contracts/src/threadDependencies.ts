import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId } from "./baseSchemas.ts";

/**
 * Why a dependency counts as finished. Every reason is a server-observed
 * fact about the dependency thread, never a client guess, so a satisfied
 * link stays satisfied across devices and reconnects.
 */
export const ThreadDependencySatisfiedReason = Schema.Literals([
  "turn-finished",
  "session-error",
  "request-opened",
  "archived",
  "deleted",
]);
export type ThreadDependencySatisfiedReason = typeof ThreadDependencySatisfiedReason.Type;

/**
 * One "depends on" edge from a blocked thread to the thread it waits on.
 * Like snooze, the link is an overlay on the active lifecycle: the blocked
 * thread stays active in the model and is only kept out of the inbox until
 * every link is satisfied or the thread raises its hand.
 */
export const ThreadDependency = Schema.Struct({
  threadId: ThreadId,
  linkedAt: IsoDateTime,
  satisfiedAt: Schema.NullOr(IsoDateTime),
  satisfiedReason: Schema.NullOr(ThreadDependencySatisfiedReason),
});
export type ThreadDependency = typeof ThreadDependency.Type;

/** The minimum a caller needs to reason about a thread's links. */
export interface ThreadDependencyHolder {
  readonly dependencies?: ReadonlyArray<ThreadDependency> | undefined;
}

export function unsatisfiedThreadDependencies(
  holder: ThreadDependencyHolder,
): ReadonlyArray<ThreadDependency> {
  return (holder.dependencies ?? []).filter((link) => link.satisfiedAt === null);
}

/**
 * The three list transforms every reducer applies (server projector,
 * projection pipeline, client reducer), kept in one place so the three
 * projections cannot drift.
 */
export function applyThreadDependencyAdded(
  dependencies: ReadonlyArray<ThreadDependency> | undefined,
  payload: { readonly dependsOnThreadId: ThreadId; readonly linkedAt: string },
): ReadonlyArray<ThreadDependency> {
  // A new link starts a new wait: satisfied links from the previous wait
  // are history and would only keep an old "woke" signal alive.
  const kept = (dependencies ?? []).filter(
    (link) => link.satisfiedAt === null && link.threadId !== payload.dependsOnThreadId,
  );
  return [
    ...kept,
    {
      threadId: payload.dependsOnThreadId,
      linkedAt: payload.linkedAt,
      satisfiedAt: null,
      satisfiedReason: null,
    },
  ];
}

export function applyThreadDependenciesRemoved(
  dependencies: ReadonlyArray<ThreadDependency> | undefined,
  payload: { readonly dependsOnThreadIds: ReadonlyArray<ThreadId> },
): ReadonlyArray<ThreadDependency> {
  const removed = new Set(payload.dependsOnThreadIds);
  return (dependencies ?? []).filter((link) => !removed.has(link.threadId));
}

export function applyThreadDependencySatisfied(
  dependencies: ReadonlyArray<ThreadDependency> | undefined,
  payload: {
    readonly dependsOnThreadId: ThreadId;
    readonly satisfiedAt: string;
    readonly reason: ThreadDependencySatisfiedReason;
  },
): ReadonlyArray<ThreadDependency> {
  return (dependencies ?? []).map((link) =>
    link.threadId === payload.dependsOnThreadId && link.satisfiedAt === null
      ? { ...link, satisfiedAt: payload.satisfiedAt, satisfiedReason: payload.reason }
      : link,
  );
}

/**
 * True when linking `blockedThreadId` to `dependsOnThreadId` would let a
 * thread wait on itself, directly or through other unsatisfied links.
 * Satisfied links are history, not edges, so they never form a cycle.
 * Shared by the decider and the client pickers so both refuse the same
 * links.
 */
export function threadDependencyWouldCycle(
  threads: ReadonlyArray<ThreadDependencyHolder & { readonly id: ThreadId }>,
  blockedThreadId: ThreadId,
  dependsOnThreadId: ThreadId,
): boolean {
  if (blockedThreadId === dependsOnThreadId) return true;
  const byId = new Map(threads.map((thread) => [thread.id, thread] as const));
  const visited = new Set<ThreadId>();
  const stack: ThreadId[] = [dependsOnThreadId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockedThreadId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const thread = byId.get(current);
    if (thread === undefined) continue;
    for (const link of unsatisfiedThreadDependencies(thread)) {
      stack.push(link.threadId);
    }
  }
  return false;
}
