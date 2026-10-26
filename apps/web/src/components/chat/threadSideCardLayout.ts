/**
 * Fork-only: where the floating side cards (Iris gateway, Roadmap) sit. They stack under the
 * thread details card at its width as one column, the first taking its place when it is hidden.
 * When the canvas is too narrow for the details card inline, or the cards above leave too little
 * height, a card leaves the layout and opens only on request over the content, like its popover.
 */

import { THREAD_DETAILS_CARD_WIDTH } from "./threadDetailsCardLayout";

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
  readonly width: number;
  /** The widest the column can be dragged from here. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export function resolveSideCardStack<Id extends string>(input: {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The chat header the cards' triggers live in. */
  readonly header: Edges;
  /**
   * The thread details card, when it is showing. Its width wins over the
   * chosen one: it narrows to keep the chat readable, and the column follows.
   */
  readonly details: (Edges & { readonly width: number; readonly maxWidth?: number }) | null;
  /** Whether the chat canvas has room for the details card inline. */
  readonly detailsColumn: boolean;
  /** The column width the user chose. */
  readonly width: number;
  /**
   * Cards top to bottom. A card's height only moves the cards after it, so
   * a card's own placement never depends on what is stacked below it.
   */
  readonly cards: ReadonlyArray<{ readonly id: Id; readonly desiredHeight: number }>;
}): ReadonlyMap<Id, SideCardPlacement> {
  const { viewport, header, details, detailsColumn, cards } = input;
  const right = details ? details.right : header.right - DETAILS_INSET;
  const maxWidth = Math.min(details?.maxWidth ?? THREAD_DETAILS_CARD_WIDTH.max, right - GAP);
  const width = Math.min(details ? details.width : input.width, maxWidth);
  const left = right - width;
  const popoverTop = header.bottom + DETAILS_INSET;
  const popover: SideCardPlacement = {
    mode: "popover",
    top: popoverTop,
    left,
    width,
    maxWidth,
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
    placements.set(card.id, { mode: "inline", top, left, width, maxWidth, maxHeight: room });
    top += Math.min(card.desiredHeight, room) + GAP;
  }
  return placements;
}
