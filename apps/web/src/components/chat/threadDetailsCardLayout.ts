import type { PreviewMiniPlayerFrame } from "../preview/previewMiniPlayerLayout";
import { DETAILS_CARD_CLEARANCE } from "./chatCanvasLayout";

export const THREAD_DETAILS_CARD_GAP = 12;
/**
 * The column the details card and the side cards share. The user drags it
 * between min and max; --thread-details-panel-width carries the chosen width
 * to the popover and the find bar.
 */
export const THREAD_DETAILS_CARD_WIDTH = { min: 240, default: 280, max: 640 } as const;

export function resolveThreadDetailsCardDensity(
  height: number,
  content: { full: number; compact: number },
  minimized = false,
) {
  if (minimized) return "essential";
  if (content.full === 0 || content.full <= height) return "full";
  if (content.compact === 0 || content.compact <= height) return "compact";
  return "essential";
}

export function resolveThreadDetailsCardLayout({
  container,
  lane,
  frame,
  overlapsDetailsCard = false,
  topInset = 0,
  width: preferredWidth = THREAD_DETAILS_CARD_WIDTH.default,
}: {
  container: { width: number; height: number };
  lane: { padding: number; minChatWidth: number };
  frame: PreviewMiniPlayerFrame | null;
  overlapsDetailsCard?: boolean;
  topInset?: number;
  /** The column width the user chose. */
  width?: number | undefined;
}) {
  const gap = THREAD_DETAILS_CARD_GAP;
  // A readable chat lane outranks the chosen width: the card narrows to keep
  // one, and only leaves for a popover when even its minimum would not fit.
  const maxWidth = Math.min(
    THREAD_DETAILS_CARD_WIDTH.max,
    container.width - gap - DETAILS_CARD_CLEARANCE - lane.padding - lane.minChatWidth,
  );
  if (maxWidth < THREAD_DETAILS_CARD_WIDTH.min) return null;
  const width = Math.max(THREAD_DETAILS_CARD_WIDTH.min, Math.min(preferredWidth, maxWidth));
  const x = container.width - width - gap;
  const y = gap + topInset;
  const height =
    overlapsDetailsCard && frame && frame.x + frame.width > x - gap && frame.x < x + width + gap
      ? Math.min(container.height - y - gap, frame.y - y - gap)
      : container.height - y - gap;
  if (height < 160) return null;
  return {
    x,
    right: gap,
    width,
    maxWidth,
    y,
    height,
  } as const;
}
