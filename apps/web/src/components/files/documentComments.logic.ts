import type { ThreadDocumentComment } from "@t3tools/contracts";

import type { ReviewCommentContext } from "~/reviewCommentContext";

/**
 * Places margin cards beside their anchors without overlap: each card sits at
 * its anchor unless the card above it reaches that far, in which case it starts
 * `gap` below that card. Returns each card's top, in anchor order.
 */
export function layoutMarginCards(
  cards: ReadonlyArray<{ readonly id: string; readonly top: number; readonly height: number }>,
  gap = 8,
): Map<string, number> {
  const tops = new Map<string, number>();
  let floor = Number.NEGATIVE_INFINITY;
  for (const card of [...cards].toSorted((a, b) => a.top - b.top)) {
    const top = Math.max(card.top, floor);
    tops.set(card.id, top);
    floor = top + card.height + gap;
  }
  return tops;
}

/** One file's comments in reading order, optionally without resolved ones. */
export function documentCommentsForFile(
  comments: ReadonlyArray<ThreadDocumentComment>,
  filePath: string,
  includeResolved: boolean,
): ThreadDocumentComment[] {
  return comments
    .filter(
      (comment) => comment.filePath === filePath && (includeResolved || comment.status === "open"),
    )
    .toSorted((a, b) => a.anchor.start - b.anchor.start);
}

/**
 * What the agent receives for a comment: a review comment whose section names
 * the comment id, which is what resolve_document_comment takes.
 */
export function documentCommentReviewContext(comment: ThreadDocumentComment): ReviewCommentContext {
  const { startLine, endLine } = comment.anchor;
  return {
    id: `document-comment:${comment.id}`,
    sectionId: `document-comment:${comment.id}`,
    sectionTitle: `Document comment ${comment.id}`,
    filePath: comment.filePath,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    text: comment.body,
    diff: comment.anchor.text,
    fenceLanguage: "quote",
  };
}
