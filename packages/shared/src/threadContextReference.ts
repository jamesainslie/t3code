import {
  type ComposerContextClipboardFragment,
  type ComposerContextId,
  type EnvironmentId,
  type ExecutionEnvironmentCapabilities,
  type ProjectId,
  type ServerSettings,
  type ThreadContextRecord,
  type ThreadId,
} from "@t3tools/contracts";

import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "./composerContextReferences.ts";
import { resolveProjectSettings } from "./projectSettings.ts";

/** Matches the bound `ThreadContextRecord.title` enforces. */
const THREAD_TITLE_MAX_CHARS = 2_048;

interface ThreadChipSource {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly title: string;
}

/**
 * One context id per thread, so the same thread pasted twice stays one record. Ids outside the
 * context id grammar, such as imported `import:<instance>:<session>` threads, fold to a slug
 * plus hash.
 */
export function threadContextId(threadId: ThreadId): ComposerContextId {
  return toComposerContextId(`thread-${threadId.toLowerCase()}`);
}

/** Cuts at the cap, backing off one unit rather than leaving a lone high surrogate. */
function capTitle(title: string): string {
  if (title.length <= THREAD_TITLE_MAX_CHARS) return title;
  const lastKept = title.charCodeAt(THREAD_TITLE_MAX_CHARS - 1);
  const isHighSurrogate = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return title.slice(0, isHighSurrogate ? THREAD_TITLE_MAX_CHARS - 1 : THREAD_TITLE_MAX_CHARS);
}

export function buildThreadContextRecord(thread: ThreadChipSource): ThreadContextRecord {
  const title = capTitle(thread.title.replace(/[\r\n]+/g, " "));
  return {
    version: 1,
    contextId: threadContextId(thread.id),
    kind: "thread",
    label: sanitizeComposerContextLabel(title, "thread"),
    environmentId: thread.environmentId,
    threadId: thread.id,
    title,
  };
}

/** `[<label>](t3-context://v1/thread/<contextId>)` */
export function threadContextMarkdown(record: ThreadContextRecord): string {
  return formatComposerContextReference(record);
}

/**
 * What "Copy as thread chip" writes: the link as plain text, which paste requires before it
 * keeps a record, and the record itself as the structured fragment.
 */
export function buildThreadChipClipboard(input: { readonly thread: ThreadChipSource }): {
  readonly text: string;
  readonly fragment: ComposerContextClipboardFragment;
} {
  const record = buildThreadContextRecord(input.thread);
  return {
    text: threadContextMarkdown(record),
    fragment: {
      version: 1,
      source: { environmentId: input.thread.environmentId },
      records: [record],
    },
  };
}

interface ContinuationServer {
  readonly settings: ServerSettings;
  readonly environment: {
    readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "threadContinuation">;
  };
}

/**
 * Whether "Continue in new thread" is offered. The server must advertise continuation, and the
 * new agent can only read the source thread when the project's thread history access resolves
 * to anything but off. False until the environment's config arrives.
 */
export function canContinueThread(
  server: ContinuationServer | null | undefined,
  projectId: ProjectId,
): boolean {
  if (server?.environment.capabilities.threadContinuation !== true) return false;
  return (
    resolveProjectSettings(server.settings, projectId).settings.agentThreadHistoryAccess !== "off"
  );
}

/** The prompt a continuation draft starts with, pointing the new agent at the source thread. */
export function buildContinuePrompt(record: ThreadContextRecord): string {
  return `Continue the work from ${threadContextMarkdown(record)}.`;
}
