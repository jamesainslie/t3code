import { useEffect, useState } from "react";

import { currentThreadDetailsColumnWidth } from "./threadDetailsColumnWidth";
import { resolveSideCardStack, type SideCardPlacement } from "./threadSideCardLayout";

/** Marks a side card's root element with its id so the cards below it can make room. */
const THREAD_SIDE_CARD_ATTRIBUTE = "data-thread-side-card";

/** The column's order, top to bottom. */
const THREAD_SIDE_CARD_ORDER = ["iris", "roadmap"] as const;
export type ThreadSideCardId = (typeof THREAD_SIDE_CARD_ORDER)[number];

function edges(element: Element) {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** The thread details card that is showing, inline or as a popover. */
function visibleDetailsCard(): Element | null {
  for (const element of document.querySelectorAll("[data-thread-details-card]")) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

/** Whether the chat canvas next to this header has room for the details card inline. */
function hasDetailsColumn(header: Element): boolean {
  for (let element = header.parentElement; element; element = element.parentElement) {
    const canvas = element.querySelector("[data-chat-canvas]");
    if (canvas) return canvas.hasAttribute("data-details-column");
  }
  return true;
}

/** The height a side card takes on screen, or null when it is not showing. */
function shownHeight(id: ThreadSideCardId): number | null {
  const element = document.querySelector(`[${THREAD_SIDE_CARD_ATTRIBUTE}="${id}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect.height : null;
}

/**
 * Where a side card goes now, given the cards above it that are showing. The
 * cards below it are left out: they never move the cards above them.
 */
export function measureThreadSideCard(id: ThreadSideCardId): SideCardPlacement | null {
  const header = document.querySelector("[data-chat-header]");
  if (!header) return null;
  const cards: Array<{ id: ThreadSideCardId; desiredHeight: number }> = [];
  for (const other of THREAD_SIDE_CARD_ORDER) {
    if (other === id) break;
    const height = shownHeight(other);
    if (height !== null) cards.push({ id: other, desiredHeight: height });
  }
  cards.push({ id, desiredHeight: 0 });
  const details = visibleDetailsCard();
  return (
    resolveSideCardStack({
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: edges(header),
      details: details ? detailsEdges(details) : null,
      detailsColumn: hasDetailsColumn(header),
      width: currentThreadDetailsColumnWidth(),
      cards,
    }).get(id) ?? null
  );
}

function detailsEdges(element: Element) {
  const rect = element.getBoundingClientRect();
  const maxWidth = Number(element.closest("[data-max-width]")?.getAttribute("data-max-width"));
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    ...(maxWidth > 0 ? { maxWidth } : {}),
  };
}

/**
 * Where a side card goes while it is wanted. The details card and the cards
 * above this one move and resize with the layout (the details card folds,
 * opens as a popover on a narrow canvas, closes), so this re-measures every
 * frame while active; that is a few queries and rects, and stops when nothing
 * wants the card.
 */
export function useThreadSideCardPlacement(
  id: ThreadSideCardId,
  active: boolean,
): SideCardPlacement | null {
  const [placement, setPlacement] = useState<SideCardPlacement | null>(null);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = "";
    const tick = () => {
      const next = measureThreadSideCard(id);
      const key = next
        ? `${next.mode}:${next.top}:${next.left}:${next.width}:${next.maxWidth}:${next.maxHeight}`
        : "";
      if (key !== last) {
        last = key;
        setPlacement(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setPlacement(null);
    };
  }, [id, active]);
  return placement;
}
