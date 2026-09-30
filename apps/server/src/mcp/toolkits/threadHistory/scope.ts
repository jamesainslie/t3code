import type {
  AgentThreadHistoryAccess,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

export interface ThreadScopeInput {
  readonly callerThreadId: ThreadId;
  readonly callerProjectId: ProjectId;
  readonly targetThreadId: ThreadId;
  readonly targetProjectId: ProjectId;
  readonly level: AgentThreadHistoryAccess;
  readonly referencedThreadIds: ReadonlySet<ThreadId>;
}

/**
 * Decides whether the calling agent may read another thread's history. Threads the user
 * referenced are readable across projects at every level except `off`.
 */
export function canReadThread(input: ThreadScopeInput): boolean {
  if (input.level === "off") return false;
  if (input.level === "environment") return true;
  if (input.targetThreadId === input.callerThreadId) return true;
  if (input.referencedThreadIds.has(input.targetThreadId)) return true;
  return input.level === "project" && input.targetProjectId === input.callerProjectId;
}

/** Searching lists threads the user never pointed at, so it needs a broad level. */
export function canSearchThreads(level: AgentThreadHistoryAccess): boolean {
  return level === "project" || level === "environment";
}

/**
 * Thread ids the user pointed the caller at: thread context records on any of its messages,
 * and the thread it was started to continue.
 */
export function collectReferencedThreadIds(
  caller: Pick<OrchestrationThread, "messages" | "continuedFromThreadId">,
): ReadonlySet<ThreadId> {
  const ids = new Set<ThreadId>();
  if (caller.continuedFromThreadId) ids.add(caller.continuedFromThreadId);
  for (const message of caller.messages) {
    for (const record of message.context?.records ?? []) {
      // Unknown records carry a payload and an arbitrary kind, so exclude them first.
      if ("payload" in record) continue;
      if (record.kind === "thread") ids.add(record.threadId);
    }
  }
  return ids;
}
