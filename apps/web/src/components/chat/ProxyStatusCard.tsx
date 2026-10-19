import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ScrollArea } from "../ui/scroll-area";
import { ThreadDetailsColumnResizeHandle } from "./threadDetailsColumnWidth";
import type { SideCardPlacement } from "./threadSideCardLayout";

/**
 * Fork-only: the Iris gateway card, stacked under the thread details card or,
 * without room for that column, opened over the chat on request. Escape or
 * the close control dismisses it; clicking elsewhere does not, because a
 * login in progress sends the user to another window.
 */
export function ProxyStatusCard({
  placement,
  onClose,
  children,
}: {
  readonly placement: SideCardPlacement;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <section
      aria-label="Iris gateway"
      className="dropdown-glass fixed isolate z-40 grid grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl"
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      data-proxy-status-card={placement.mode}
      data-thread-side-card="iris"
    >
      <ScrollArea scrollFade className="min-h-0">
        {children}
      </ScrollArea>
      <ThreadDetailsColumnResizeHandle width={placement.width} maxWidth={placement.maxWidth} />
    </section>,
    document.body,
  );
}
