import {
  type ComposerContextClipboardFragment,
  type ComposerContextId,
  type EnvironmentId,
  type ProjectId,
  type ThreadContextRecord,
  type ThreadId,
} from "@t3tools/contracts";

import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
  toComposerContextId,
} from "./composerContextReferences.ts";

/** Matches the bound `ThreadContextRecord.title` enforces. */
const THREAD_TITLE_MAX_CHARS = 2_048;

interface ThreadChipSource {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
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
    threadId: thread.id,
    projectId: thread.projectId,
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
export function buildThreadChipClipboard(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: ThreadChipSource;
}): { readonly text: string; readonly fragment: ComposerContextClipboardFragment } {
  const record = buildThreadContextRecord(input.thread);
  return {
    text: threadContextMarkdown(record),
    fragment: {
      version: 1,
      source: { environmentId: input.environmentId },
      records: [record],
    },
  };
}
