import {
  ComposerContextId,
  type ComposerContextClipboardFragment,
  type EnvironmentId,
  type ProjectId,
  type ThreadContextRecord,
  type ThreadId,
} from "@t3tools/contracts";

import {
  formatComposerContextReference,
  sanitizeComposerContextLabel,
} from "./composerContextReferences.ts";

/** Matches the bound `ThreadContextRecord.title` enforces. */
const THREAD_TITLE_MAX_CHARS = 2_048;

interface ThreadChipSource {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
}

/** One context id per thread, so the same thread pasted twice stays one record. */
export function threadContextId(threadId: ThreadId): ComposerContextId {
  return ComposerContextId.make(`thread-${threadId.toLowerCase()}`);
}

export function buildThreadContextRecord(thread: ThreadChipSource): ThreadContextRecord {
  const title = thread.title.replace(/[\r\n]+/g, " ").slice(0, THREAD_TITLE_MAX_CHARS);
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
