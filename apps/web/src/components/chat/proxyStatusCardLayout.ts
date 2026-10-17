/**
 * Fork-only: where the Iris gateway card sits. It stacks under the thread
 * details card at the same width, so the two read as one column; with no
 * details card showing it takes that card's place under the header.
 *
 * It yields that column on the details card's own terms. When the canvas is
 * too narrow for the details card inline, or the details card leaves too
 * little height below it, the card stops being part of the layout and opens
 * only on request, under the header and over whatever is there, like the
 * details card's popover.
 */

/** Matches the thread details card (`--thread-details-panel-width`). */
export const PROXY_CARD_WIDTH = 280;
/** Gap below the details card, and to the viewport's edges. */
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

export interface ProxyCardPlacement {
  readonly mode: "inline" | "popover";
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
}

export function resolveProxyCardPlacement(input: {
  readonly viewport: { readonly width: number; readonly height: number };
  /** The chat header the pill lives in. */
  readonly header: Edges;
  /** The thread details card, when it is showing. */
  readonly details: Edges | null;
  /** Whether the chat canvas has room for the details card inline. */
  readonly detailsColumn: boolean;
}): ProxyCardPlacement {
  const { viewport, header, details, detailsColumn } = input;
  const right = details ? details.right : header.right - DETAILS_INSET;
  const left = Math.max(GAP, right - PROXY_CARD_WIDTH);
  const below = details ? details.bottom + GAP : header.bottom + DETAILS_INSET;
  if (detailsColumn && viewport.height - GAP - below >= MIN_HEIGHT) {
    return { mode: "inline", top: below, left, maxHeight: viewport.height - GAP - below };
  }
  const top = header.bottom + DETAILS_INSET;
  return { mode: "popover", top, left, maxHeight: Math.max(0, viewport.height - GAP - top) };
}
