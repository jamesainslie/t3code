/**
 * Fork-only: where the floating side cards (the Iris gateway card, the
 * Roadmap card) sit. They stack under the thread details card at the same
 * width, so they read as one column; with no details card showing the first
 * takes that card's place under the header.
 *
 * They yield that column on the details card's own terms. When the canvas is
 * too narrow for the details card inline, or the cards above leave too little
 * height, a card stops being part of the layout and opens only on request,
 * under the header and over whatever is there, like the details card's
 * popover.
 */

/** Matches the thread details card (`--thread-details-panel-width`). */
export const THREAD_SIDE_CARD_WIDTH = 280;
/** Gap below the details card, between cards, and to the viewport's edges. */
const GAP = 8;
/** The details card's own inset from the canvas edge. */
const DETAILS_INSET = 12;
/** The details card's own floor before it leaves the canvas for a popover. */
const MIN_HEIGHT = 160;

interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SideCardPlacement {
  readonly mode: "inline" | "popover";
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
}

export function resolveSideCardStack<Id extends string>(input: {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The chat header the cards' triggers live in. */
  readonly header: Edges;
  /** The thread details card, when it is showing. */
  readonly details: Edges | null;
  /** Whether the chat canvas has room for the details card inline. */
  readonly detailsColumn: boolean;
  /**
   * Cards top to bottom. A card's height only moves the cards after it, so
   * a card's own placement never depends on what is stacked below it.
   */
  readonly cards: ReadonlyArray<{ readonly id: Id; readonly desiredHeight: number }>;
}): ReadonlyMap<Id, SideCardPlacement> {
  const { viewport, header, details, detailsColumn, cards } = input;
  const right = details ? details.right : header.right - DETAILS_INSET;
  const left = Math.max(GAP, right - THREAD_SIDE_CARD_WIDTH);
  const popoverTop = header.bottom + DETAILS_INSET;
  const popover: SideCardPlacement = {
    mode: "popover",
    top: popoverTop,
    left,
    maxHeight: Math.max(0, viewport.height - GAP - popoverTop),
  };
  const placements = new Map<Id, SideCardPlacement>();
  let top = details ? details.bottom + GAP : header.bottom + DETAILS_INSET;
  for (const card of cards) {
    const room = viewport.height - GAP - top;
    if (!detailsColumn || room < MIN_HEIGHT) {
      placements.set(card.id, popover);
      continue;
    }
    placements.set(card.id, { mode: "inline", top, left, maxHeight: room });
    top += Math.min(card.desiredHeight, room) + GAP;
  }
  return placements;
}
