import { ThreadId, type ThreadDocumentComment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyThreadDocumentCommentEvent } from "./threadDocumentComments.ts";

const THREAD_ID = ThreadId.make("thread-1");
const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

function comment(overrides: Partial<ThreadDocumentComment> = {}): ThreadDocumentComment {
  return {
    id: "comment-1",
    filePath: "docs/plan.md",
    anchor: {
      text: "passage",
      start: 0,
      end: 7,
      prefix: "",
      suffix: "",
      startLine: 1,
      endLine: 1,
    },
    body: "Tighten this.",
    status: "open",
    resolution: null,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
    ...overrides,
  };
}

describe("applyThreadDocumentCommentEvent", () => {
  it("appends added comments in creation order and replaces a replayed id", () => {
    const early = comment({ id: "early", createdAt: NOW });
    const late = comment({ id: "late", createdAt: LATER });
    const added = applyThreadDocumentCommentEvent([late], {
      type: "thread.document-comment-added",
      payload: { threadId: THREAD_ID, comment: early },
    });
    expect(added.map((entry) => entry.id)).toEqual(["early", "late"]);

    const replayed = applyThreadDocumentCommentEvent(added, {
      type: "thread.document-comment-added",
      payload: { threadId: THREAD_ID, comment: { ...early, body: "Replayed." } },
    });
    expect(replayed.map((entry) => [entry.id, entry.body])).toEqual([
      ["early", "Replayed."],
      ["late", "Tighten this."],
    ]);
  });

  it("patches the body on update", () => {
    const next = applyThreadDocumentCommentEvent([comment()], {
      type: "thread.document-comment-updated",
      payload: { threadId: THREAD_ID, commentId: "comment-1", body: "Rewrite.", updatedAt: LATER },
    });
    expect(next).toEqual([comment({ body: "Rewrite.", updatedAt: LATER })]);
  });

  it("removes a deleted comment", () => {
    const next = applyThreadDocumentCommentEvent([comment(), comment({ id: "other" })], {
      type: "thread.document-comment-deleted",
      payload: { threadId: THREAD_ID, commentId: "comment-1", deletedAt: LATER },
    });
    expect(next.map((entry) => entry.id)).toEqual(["other"]);
  });

  it("resolves an open comment and keeps the first resolution on re-resolve", () => {
    const resolved = applyThreadDocumentCommentEvent([comment()], {
      type: "thread.document-comment-resolved",
      payload: {
        threadId: THREAD_ID,
        commentId: "comment-1",
        resolution: "Split it.",
        resolvedAt: LATER,
      },
    });
    expect(resolved).toEqual([
      comment({ status: "resolved", resolution: "Split it.", resolvedAt: LATER, updatedAt: LATER }),
    ]);

    const again = applyThreadDocumentCommentEvent(resolved, {
      type: "thread.document-comment-resolved",
      payload: {
        threadId: THREAD_ID,
        commentId: "comment-1",
        resolution: null,
        resolvedAt: "2026-01-03T00:00:00.000Z",
      },
    });
    expect(again).toBe(resolved);
  });

  it("reopens a resolved comment, clearing the resolution, and ignores reopening an open one", () => {
    const resolved = comment({ status: "resolved", resolution: "Done.", resolvedAt: NOW });
    const reopened = applyThreadDocumentCommentEvent([resolved], {
      type: "thread.document-comment-reopened",
      payload: { threadId: THREAD_ID, commentId: "comment-1", reopenedAt: LATER },
    });
    expect(reopened).toEqual([comment({ updatedAt: LATER })]);

    const again = applyThreadDocumentCommentEvent(reopened, {
      type: "thread.document-comment-reopened",
      payload: { threadId: THREAD_ID, commentId: "comment-1", reopenedAt: LATER },
    });
    expect(again).toBe(reopened);
  });

  it("returns the same array for an unknown comment id", () => {
    const comments = [comment()];
    expect(
      applyThreadDocumentCommentEvent(comments, {
        type: "thread.document-comment-updated",
        payload: { threadId: THREAD_ID, commentId: "missing", body: "Nope.", updatedAt: LATER },
      }),
    ).toBe(comments);
  });
});
