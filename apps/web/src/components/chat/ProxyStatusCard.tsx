import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ScrollArea } from "../ui/scroll-area";
import {
  PROXY_CARD_WIDTH,
  resolveProxyCardPlacement,
  type ProxyCardPlacement,
} from "./proxyStatusCardLayout";

/** Marks the pill so the card can find the header it belongs to. */
export const PROXY_PILL_ATTRIBUTE = "data-proxy-usage-pill";

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

function measure(): ProxyCardPlacement | null {
  const pill = document.querySelector(`[${PROXY_PILL_ATTRIBUTE}]`);
  if (!pill) return null;
  const header = pill.closest("header") ?? pill;
  const details = visibleDetailsCard();
  return resolveProxyCardPlacement({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    header: edges(header),
    details: details ? edges(details) : null,
  });
}

/**
 * Fork-only: the Iris gateway card, stacked under the thread details card.
 * The details card moves and resizes with the layout (it folds, opens as a
 * popover on a narrow canvas, closes), so the card re-measures every frame
 * while it is open; that is one query and two rects, and stops on close.
 * Escape or the close control dismisses it; clicking elsewhere does not,
 * because a login in progress sends the user to another window.
 */
export function ProxyStatusCard({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const [placement, setPlacement] = useState<ProxyCardPlacement | null>(null);

  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const next = measure();
      const key = next ? `${next.top}:${next.left}:${next.maxHeight}` : "";
      if (key !== last) {
        last = key;
        setPlacement(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!placement) return null;
  return createPortal(
    <section
      aria-label="Iris gateway"
      className="dropdown-glass fixed isolate z-40 grid grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl"
      style={{
        top: placement.top,
        left: placement.left,
        width: PROXY_CARD_WIDTH,
        maxHeight: placement.maxHeight,
      }}
      data-proxy-status-card=""
    >
      <ScrollArea scrollFade className="min-h-0">
        {children}
      </ScrollArea>
    </section>,
    document.body,
  );
}
