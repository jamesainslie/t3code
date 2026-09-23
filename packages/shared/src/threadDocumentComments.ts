import type {
  ThreadDocumentComment,
  ThreadDocumentCommentAddedPayload,
  ThreadDocumentCommentDeletedPayload,
  ThreadDocumentCommentReopenedPayload,
  ThreadDocumentCommentResolvedPayload,
  ThreadDocumentCommentUpdatedPayload,
} from "@t3tools/contracts";

import { compareDateTimeStrings } from "./dateTime.ts";

export type ThreadDocumentCommentEvent =
  | {
      readonly type: "thread.document-comment-added";
      readonly payload: ThreadDocumentCommentAddedPayload;
    }
  | {
      readonly type: "thread.document-comment-updated";
      readonly payload: ThreadDocumentCommentUpdatedPayload;
    }
  | {
      readonly type: "thread.document-comment-deleted";
      readonly payload: ThreadDocumentCommentDeletedPayload;
    }
  | {
      readonly type: "thread.document-comment-resolved";
      readonly payload: ThreadDocumentCommentResolvedPayload;
    }
  | {
      readonly type: "thread.document-comment-reopened";
      readonly payload: ThreadDocumentCommentReopenedPayload;
    };

function patchComment(
  comments: ReadonlyArray<ThreadDocumentComment>,
  commentId: string,
  patch: (comment: ThreadDocumentComment) => ThreadDocumentComment,
): ReadonlyArray<ThreadDocumentComment> {
  const index = comments.findIndex((comment) => comment.id === commentId);
  const current = comments[index];
  if (current === undefined) return comments;
  const next = patch(current);
  if (next === current) return comments;
  const patched = [...comments];
  patched[index] = next;
  return patched;
}

/**
 * Applies one document comment event to a thread's comments, kept in creation
 * order. Shared by the server projector and the client thread reducer so both
 * agree; no-ops (unknown ids, re-resolving, re-opening) return the input array.
 */
export function applyThreadDocumentCommentEvent(
  comments: ReadonlyArray<ThreadDocumentComment>,
  event: ThreadDocumentCommentEvent,
): ReadonlyArray<ThreadDocumentComment> {
  switch (event.type) {
    case "thread.document-comment-added": {
      const added = event.payload.comment;
      // Plain sort: Hermes lacks toSorted, and this runs on mobile.
      return [...comments.filter((comment) => comment.id !== added.id), added].sort(
        (left, right) =>
          compareDateTimeStrings(left.createdAt, right.createdAt) ||
          left.id.localeCompare(right.id),
      );
    }
    case "thread.document-comment-updated":
      return patchComment(comments, event.payload.commentId, (comment) => ({
        ...comment,
        body: event.payload.body,
        updatedAt: event.payload.updatedAt,
      }));
    case "thread.document-comment-deleted": {
      const remaining = comments.filter((comment) => comment.id !== event.payload.commentId);
      return remaining.length === comments.length ? comments : remaining;
    }
    case "thread.document-comment-resolved":
      return patchComment(comments, event.payload.commentId, (comment) =>
        comment.status === "resolved"
          ? comment
          : {
              ...comment,
              status: "resolved",
              resolution: event.payload.resolution,
              resolvedAt: event.payload.resolvedAt,
              updatedAt: event.payload.resolvedAt,
            },
      );
    case "thread.document-comment-reopened":
      return patchComment(comments, event.payload.commentId, (comment) =>
        comment.status === "open"
          ? comment
          : {
              ...comment,
              status: "open",
              resolution: null,
              resolvedAt: null,
              updatedAt: event.payload.reopenedAt,
            },
      );
  }
}
