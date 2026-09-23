import type { ThreadDocumentComment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  documentCommentReviewContext,
  documentCommentsForFile,
  layoutMarginCards,
} from "./documentComments.logic";

function comment(overrides: Partial<ThreadDocumentComment> = {}): ThreadDocumentComment {
  return {
    id: "c1",
    filePath: "rfcs/RFC-1.md",
    anchor: {
      text: "Titan Hybrid Cloud Terraform state",
      start: 10,
      end: 44,
      prefix: "Abstract ",
      suffix: " and the planned",
      startLine: 16,
      endLine: 16,
    },
    body: "Say which regions.",
    status: "open",
    resolution: null,
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("layoutMarginCards", () => {
  it("keeps cards at their anchors when they do not collide", () => {
    expect(
      layoutMarginCards([
        { id: "a", top: 0, height: 40 },
        { id: "b", top: 100, height: 40 },
      ]),
    ).toEqual(
      new Map([
        ["a", 0],
        ["b", 100],
      ]),
    );
  });

  it("pushes a colliding card below the one above it, in anchor order", () => {
    const tops = layoutMarginCards(
      [
        { id: "late", top: 30, height: 50 },
        { id: "early", top: 10, height: 60 },
      ],
      8,
    );

    expect(tops.get("early")).toBe(10);
    expect(tops.get("late")).toBe(78);
  });

  it("cascades pushes through a run of cards", () => {
    const tops = layoutMarginCards(
      [
        { id: "a", top: 0, height: 20 },
        { id: "b", top: 0, height: 20 },
        { id: "c", top: 0, height: 20 },
      ],
      4,
    );

    expect([...tops.values()]).toEqual([0, 24, 48]);
  });
});

describe("documentCommentsForFile", () => {
  it("keeps one file's comments in document order and hides resolved ones on request", () => {
    const comments = [
      comment({ id: "later", anchor: { ...comment().anchor, start: 90, end: 95 } }),
      comment({ id: "other-file", filePath: "README.md" }),
      comment({ id: "earlier" }),
      comment({ id: "done", status: "resolved" }),
    ];

    expect(documentCommentsForFile(comments, "rfcs/RFC-1.md", true).map((c) => c.id)).toEqual([
      "earlier",
      "done",
      "later",
    ]);
    expect(documentCommentsForFile(comments, "rfcs/RFC-1.md", false).map((c) => c.id)).toEqual([
      "earlier",
      "later",
    ]);
  });
});

describe("documentCommentReviewContext", () => {
  it("names the comment id where the agent reads it, with lines, body and quote", () => {
    const context = documentCommentReviewContext(
      comment({ anchor: { ...comment().anchor, startLine: 16, endLine: 18 } }),
    );

    expect(context).toMatchObject({
      id: "document-comment:c1",
      sectionTitle: "Document comment c1",
      filePath: "rfcs/RFC-1.md",
      startIndex: 15,
      endIndex: 17,
      rangeLabel: "L16 to L18",
      text: "Say which regions.",
      diff: "Titan Hybrid Cloud Terraform state",
      fenceLanguage: "quote",
    });
  });

  it("labels a single line without a range", () => {
    expect(documentCommentReviewContext(comment()).rangeLabel).toBe("L16");
  });
});
