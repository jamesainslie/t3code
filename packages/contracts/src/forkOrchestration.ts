/**
 * Fork-only orchestration contracts: the fields the fork adds to v2 threads,
 * the fork thread commands, document comments, and project sync records.
 *
 * Upstream contracts reach this module through single spread or union lines,
 * so upstream merges stay mechanical. Keep fork schema here rather than in
 * `orchestrationV2.ts`.
 */
import * as Schema from "effect/Schema";

import {
  ASSISTANT_CITATION_CONTEXT_LENGTH,
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
} from "./assistantCitations.ts";
import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";
import { OrchestrationProjectShell } from "./orchestrationProject.ts";
import { ThreadDependency, ThreadDependencySatisfiedReason } from "./threadDependencies.ts";

const THREAD_HIGHLIGHT_COLOR_MAX_LENGTH = 32;

/** User-chosen CSS color string (typically hex) for a thread highlight. */
export const ThreadHighlightColor = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_HIGHLIGHT_COLOR_MAX_LENGTH),
);
export type ThreadHighlightColor = typeof ThreadHighlightColor.Type;

export const SNOOZE_REMINDER_MAX_CHARS = 500;

/**
 * A note the user attaches to a snooze. Empty means "clear the note", which is
 * why this allows the empty string after trimming.
 */
export const SnoozeReminder = TrimmedString.check(Schema.isMaxLength(SNOOZE_REMINDER_MAX_CHARS));
export type SnoozeReminder = typeof SnoozeReminder.Type;

/**
 * Fields the fork adds to the v2 app thread and its shell. Every field is
 * optional so upstream-shaped payloads, and threads that never used a fork
 * feature, still decode. They ride on `thread.metadata-updated` like other
 * thread metadata, so the fork adds no event types for them.
 */
export const ForkThreadFields = {
  highlightColor: Schema.optional(Schema.NullOr(ThreadHighlightColor)),
  /** Threads this one waits on; it stays parked until every link is satisfied. */
  dependencies: Schema.optional(Schema.Array(ThreadDependency)),
  /** Note shown in the chat when a snoozed thread wakes; cleared once delivered. */
  snoozeReminder: Schema.optional(Schema.NullOr(SnoozeReminder)),
  /** The thread whose work this one continues; that thread stays readable to the agent. */
  continuedFromThreadId: Schema.optional(Schema.NullOr(ThreadId)),
} as const;

type ForkThreadFieldValues = {
  readonly [K in keyof typeof ForkThreadFields]?: (typeof ForkThreadFields)[K]["Type"];
};

/** A thread's fork fields, for code that copies thread fields one by one (shell builders). */
export function pickForkThreadFields(thread: ForkThreadFieldValues): ForkThreadFieldValues {
  return {
    ...(thread.highlightColor === undefined ? {} : { highlightColor: thread.highlightColor }),
    ...(thread.dependencies === undefined ? {} : { dependencies: thread.dependencies }),
    ...(thread.snoozeReminder === undefined ? {} : { snoozeReminder: thread.snoozeReminder }),
    ...(thread.continuedFromThreadId === undefined
      ? {}
      : { continuedFromThreadId: thread.continuedFromThreadId }),
  };
}

/** Extra fields on upstream's `thread.snooze` command. */
export const ForkSnoozeCommandFields = {
  /** Absent keeps the note of a pending snooze, "" clears it, any other value replaces it. */
  reminder: Schema.optional(SnoozeReminder),
} as const;

/** Extra fields on upstream's `thread.create` command. */
export const ForkThreadCreateCommandFields = {
  /** Dropped when the source thread is missing or deleted. */
  continuedFromThreadId: Schema.optional(ThreadId),
} as const;

/** Fork thread mutations a client may request. */
export const ForkThreadUpdate = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("highlight.set"),
    /** null clears the highlight. */
    color: Schema.NullOr(ThreadHighlightColor),
  }),
  Schema.Struct({
    kind: Schema.Literal("dependency.add"),
    dependsOnThreadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("dependency.remove"),
    /**
     * "Wake" sends every link; Undo on the link toast sends one. Ids that are
     * not linked are ignored so the command is safe to repeat.
     */
    dependsOnThreadIds: Schema.NonEmptyArray(ThreadId),
  }),
]);
export type ForkThreadUpdate = typeof ForkThreadUpdate.Type;

export const ForkThreadUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.update"),
  commandId: CommandId,
  threadId: ThreadId,
  update: ForkThreadUpdate,
});
export type ForkThreadUpdateCommand = typeof ForkThreadUpdateCommand.Type;

/** Fork thread mutations only the server dispatches. */
export const ForkThreadInternalUpdate = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("dependency.satisfy"),
    dependsOnThreadId: ThreadId,
    reason: ThreadDependencySatisfiedReason,
    satisfiedAt: IsoDateTime,
  }),
  Schema.Struct({
    /** Writes the pending reminder into the chat once the wake time has passed. */
    kind: Schema.Literal("snooze-reminder.deliver"),
  }),
]);
export type ForkThreadInternalUpdate = typeof ForkThreadInternalUpdate.Type;

export const ForkThreadInternalUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.internal-update"),
  commandId: CommandId,
  threadId: ThreadId,
  update: ForkThreadInternalUpdate,
});
export type ForkThreadInternalUpdateCommand = typeof ForkThreadInternalUpdateCommand.Type;

/**
 * Title of the `system_notice` turn item a delivered snooze reminder becomes. The note
 * reaches the timeline without starting a run; clients render it as the reminder row.
 */
export const SNOOZE_REMINDER_NOTICE_TITLE = "Snooze reminder";

/** Reserved for immutable conversations owned by another T3 environment. */
export const isSyncedThreadId = (threadId: string): boolean => threadId.startsWith("t3sync-");

// ---------------------------------------------------------------------------
// Document comments
// ---------------------------------------------------------------------------

export const THREAD_DOCUMENT_COMMENT_MAX_BODY_LENGTH = 8_000;
const THREAD_DOCUMENT_COMMENT_MAX_PATH_LENGTH = 4_096;

export const ThreadDocumentCommentId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type ThreadDocumentCommentId = typeof ThreadDocumentCommentId.Type;

/**
 * Where a document comment points. Lines are 1-based source lines as of when the
 * comment was made. Like a citation, `text` with its rendered-text offsets and
 * surrounding context finds the passage again after the file changes.
 */
export const ThreadDocumentCommentAnchor = Schema.Struct({
  text: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(ASSISTANT_CITATION_MAX_TEXT_LENGTH),
  ),
  start: NonNegativeInt,
  end: NonNegativeInt,
  prefix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  suffix: Schema.String.check(Schema.isMaxLength(ASSISTANT_CITATION_CONTEXT_LENGTH)),
  startLine: PositiveInt,
  endLine: PositiveInt,
});
export type ThreadDocumentCommentAnchor = typeof ThreadDocumentCommentAnchor.Type;

export const ThreadDocumentCommentStatus = Schema.Literals(["open", "resolved"]);
export type ThreadDocumentCommentStatus = typeof ThreadDocumentCommentStatus.Type;

export const ThreadDocumentCommentBody = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_DOCUMENT_COMMENT_MAX_BODY_LENGTH),
);

/**
 * A user's margin comment on a rendered workspace file, kept per thread and
 * never written into the file. The agent resolves it once addressed.
 */
export const ThreadDocumentComment = Schema.Struct({
  id: ThreadDocumentCommentId,
  filePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(THREAD_DOCUMENT_COMMENT_MAX_PATH_LENGTH),
  ),
  anchor: ThreadDocumentCommentAnchor,
  body: ThreadDocumentCommentBody,
  status: ThreadDocumentCommentStatus,
  /** The agent's note on how it addressed the comment. */
  resolution: Schema.NullOr(ThreadDocumentCommentBody),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type ThreadDocumentComment = typeof ThreadDocumentComment.Type;

export const ThreadDocumentCommentAddedPayload = Schema.Struct({
  threadId: ThreadId,
  comment: ThreadDocumentComment,
});
export type ThreadDocumentCommentAddedPayload = typeof ThreadDocumentCommentAddedPayload.Type;

export const ThreadDocumentCommentUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  commentId: ThreadDocumentCommentId,
  body: ThreadDocumentCommentBody,
  updatedAt: IsoDateTime,
});
export type ThreadDocumentCommentUpdatedPayload = typeof ThreadDocumentCommentUpdatedPayload.Type;

export const ThreadDocumentCommentDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  commentId: ThreadDocumentCommentId,
  deletedAt: IsoDateTime,
});
export type ThreadDocumentCommentDeletedPayload = typeof ThreadDocumentCommentDeletedPayload.Type;

export const ThreadDocumentCommentResolvedPayload = Schema.Struct({
  threadId: ThreadId,
  commentId: ThreadDocumentCommentId,
  resolution: Schema.NullOr(ThreadDocumentCommentBody),
  resolvedAt: IsoDateTime,
});
export type ThreadDocumentCommentResolvedPayload = typeof ThreadDocumentCommentResolvedPayload.Type;

export const ThreadDocumentCommentReopenedPayload = Schema.Struct({
  threadId: ThreadId,
  commentId: ThreadDocumentCommentId,
  reopenedAt: IsoDateTime,
});
export type ThreadDocumentCommentReopenedPayload = typeof ThreadDocumentCommentReopenedPayload.Type;

/** One comment mutation a client requests; the server stamps the times. */
export const ThreadDocumentCommentMutation = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    commentId: ThreadDocumentCommentId,
    filePath: ThreadDocumentComment.fields.filePath,
    anchor: ThreadDocumentCommentAnchor,
    body: ThreadDocumentCommentBody,
  }),
  Schema.Struct({
    type: Schema.Literal("update"),
    commentId: ThreadDocumentCommentId,
    body: ThreadDocumentCommentBody,
  }),
  Schema.Struct({ type: Schema.Literal("delete"), commentId: ThreadDocumentCommentId }),
  Schema.Struct({
    type: Schema.Literal("resolve"),
    commentId: ThreadDocumentCommentId,
    resolution: Schema.NullOr(ThreadDocumentCommentBody),
  }),
  Schema.Struct({ type: Schema.Literal("reopen"), commentId: ThreadDocumentCommentId }),
]);
export type ThreadDocumentCommentMutation = typeof ThreadDocumentCommentMutation.Type;

export const ThreadDocumentCommentMutateInput = Schema.Struct({
  threadId: ThreadId,
  mutation: ThreadDocumentCommentMutation,
});
export type ThreadDocumentCommentMutateInput = typeof ThreadDocumentCommentMutateInput.Type;

export const ThreadDocumentCommentsInput = Schema.Struct({ threadId: ThreadId });
export type ThreadDocumentCommentsInput = typeof ThreadDocumentCommentsInput.Type;

/** A thread's comments in creation order; each change streams the whole list. */
export const ThreadDocumentComments = Schema.Struct({
  threadId: ThreadId,
  comments: Schema.Array(ThreadDocumentComment),
});
export type ThreadDocumentComments = typeof ThreadDocumentComments.Type;

// ---------------------------------------------------------------------------
// Project sync records
// ---------------------------------------------------------------------------

export const ProjectSyncMapping = Schema.Struct({
  sourceProjectId: ProjectId,
  projectId: Schema.NullOr(ProjectId),
});
export type ProjectSyncMapping = typeof ProjectSyncMapping.Type;

/** A project as a sync record stored it: the shell plus its deletion time. */
export const ProjectSyncProjectSnapshot = Schema.Struct({
  ...OrchestrationProjectShell.fields,
  deletedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});
export type ProjectSyncProjectSnapshot = typeof ProjectSyncProjectSnapshot.Type;

export const ProjectSyncRecord = Schema.Struct({
  id: TrimmedNonEmptyString,
  sourceId: TrimmedNonEmptyString,
  sourceHome: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  parentId: Schema.NullOr(TrimmedNonEmptyString),
  undoBatchId: Schema.NullOr(TrimmedNonEmptyString),
  schedule: Schema.optional(
    Schema.Struct({ enabled: Schema.Boolean, hour: NonNegativeInt, timezone: Schema.String }),
  ),
  contentHash: TrimmedNonEmptyString,
  mappings: Schema.Array(ProjectSyncMapping),
  visibleThreadIds: Schema.Array(ThreadId),
  hiddenThreadIds: Schema.Array(ThreadId),
  projectChanges: Schema.Array(
    Schema.Struct({
      before: Schema.NullOr(ProjectSyncProjectSnapshot),
      after: ProjectSyncProjectSnapshot,
      ownedSettings: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
export type ProjectSyncRecord = typeof ProjectSyncRecord.Type;
