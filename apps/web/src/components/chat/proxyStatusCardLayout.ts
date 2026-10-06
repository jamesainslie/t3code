/**
 * Fork-only: where the Iris gateway card sits. It stacks under the thread
 * details card at the same width, so the two read as one column; with no
 * details card showing it takes that card's place under the header. It never
 * runs off screen: short of room it rises over the details card's foot, but
 * never above the header, and scrolls inside whatever height is left.
 */

/** Matches the thread details card (`--thread-details-panel-width`). */
export const PROXY_CARD_WIDTH = 280;
/** Gap below the details card, and to the viewport's edges. */
const GAP = 8;
/** The details card's own inset from the canvas edge. */
const DETAILS_INSET = 12;
/** The least height worth showing before the card rises to find more. */
const MIN_HEIGHT = 240;

interface Edges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface ProxyCardPlacement {
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
}): ProxyCardPlacement {
  const { viewport, header, details } = input;
  const right = details ? details.right : header.right - DETAILS_INSET;
  const left = Math.max(GAP, right - PROXY_CARD_WIDTH);
  const floor = header.bottom + GAP;
  let top = details ? details.bottom + GAP : header.bottom + DETAILS_INSET;
  if (viewport.height - GAP - top < MIN_HEIGHT) {
    top = Math.max(floor, viewport.height - GAP - MIN_HEIGHT);
  }
  return { top, left, maxHeight: viewport.height - GAP - top };
}
