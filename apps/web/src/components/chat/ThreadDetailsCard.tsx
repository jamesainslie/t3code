import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import type { ScopedThreadRef } from "@lathe/contracts";
import * as Schema from "effect/Schema";
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { cn } from "../../lib/utils";
import { Popover, PopoverPopup, PopoverCreateHandle } from "../ui/popover";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { useChatCanvas } from "./ChatCanvasContext";
import {
  THREAD_DETAILS_CARD_GAP,
  resolveThreadDetailsCardDensity,
  resolveThreadDetailsCardLayout,
} from "./threadDetailsCardLayout";
import {
  ThreadDetailsColumnResizeHandle,
  useThreadDetailsColumnWidth,
} from "./threadDetailsColumnWidth";
import { observeResize } from "../../lib/observeResize";

const THREAD_DETAILS_MINIMIZED_STORAGE_KEY = "lathe:thread-details-card-minimized";

export function ThreadDetailsCard({
  threadRef,
  anchor,
  handle,
  onPresentationChange,
  children,
}: {
  threadRef: ScopedThreadRef;
  anchor: RefObject<Element | null>;
  handle: ReturnType<typeof PopoverCreateHandle>;
  onPresentationChange: (presentation: ThreadPanelPresentation) => void;
  children: (density: "full" | "compact" | "essential") => ReactNode;
}) {
  const canvas = useChatCanvas();
  const columnWidth = useThreadDetailsColumnWidth();
  const preferredPlacement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: null,
        topInset: canvas.detailsCardTopInset,
        width: columnWidth,
      })
    : null;
  const placement = canvas
    ? resolveThreadDetailsCardLayout({
        container: canvas.container,
        lane: canvas.lane,
        frame: canvas.layout.frame,
        overlapsDetailsCard: canvas.layout.overlapsDetailsCard,
        topInset: canvas.detailsCardTopInset,
        width: columnWidth,
      })
    : null;
  const mode = placement ? "inline" : "popover";
  const topInset = canvas?.detailsCardTopInset ?? 0;
  const inlineOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "inline"),
  );
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  const [minimized, setMinimized] = useLocalStorage(
    THREAD_DETAILS_MINIMIZED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const measurementKey = `${threadRef.environmentId}:${threadRef.threadId}:${preferredPlacement?.width ?? "popup"}:${minimized}`;
  const [measurements, setMeasurements] = useState({
    key: measurementKey,
    heights: { full: 0, compact: 0 },
    fullContentHeight: 0,
  });
  const contentHeights =
    measurements.key === measurementKey ? measurements.heights : { full: 0, compact: 0 };
  const height = placement?.height ?? Math.max(0, (canvas?.container.height ?? 0) - 52);
  const density = resolveThreadDetailsCardDensity(height, contentHeights, minimized);
  const reportDetailsCard = canvas?.reportDetailsCard;
  const cardLeft = preferredPlacement?.x;
  const cardRight = preferredPlacement
    ? preferredPlacement.x + preferredPlacement.width
    : undefined;
  const cardBottom =
    preferredPlacement && measurements.key === measurementKey && measurements.fullContentHeight > 0
      ? preferredPlacement.y + Math.min(measurements.fullContentHeight, preferredPlacement.height)
      : undefined;
  useLayoutEffect(() => {
    reportDetailsCard?.(
      inlineOpen && cardLeft !== undefined && cardRight !== undefined && cardBottom !== undefined
        ? { left: cardLeft, right: cardRight, bottom: cardBottom }
        : null,
    );
  }, [reportDetailsCard, inlineOpen, cardLeft, cardRight, cardBottom]);
  useLayoutEffect(() => () => reportDetailsCard?.(null), [reportDetailsCard]);
  useLayoutEffect(() => {
    onPresentationChange(mode);
    if (mode === "inline" && popoverOpen)
      useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", false);
  }, [mode, onPresentationChange, threadRef, popoverOpen]);
  useLayoutEffect(() => {
    const element = contentElement;
    if (!element) return;
    // Minimized, the essentials are all the card ever shows: only the height
    // it takes is measured, so the chat and the side cards make room for that.
    if (density === "essential" && !minimized) return;
    const measure = () => {
      const frame = element.closest<HTMLElement>("[data-thread-details-card]");
      const next = element.offsetHeight + (frame ? frame.offsetHeight - frame.clientHeight : 0);
      // PR lists and lineage scroll as they expand. Counting them toward density would hide
      // the section and workspace controls when the user asks to see more rows.
      const lists = element.querySelectorAll<HTMLElement>(
        "[data-thread-relationships-panel], [data-thread-details-pr-list]",
      );
      const fittingHeight =
        next - Array.from(lists).reduce((sum, list) => sum + list.offsetHeight, 0);
      setMeasurements((current) => {
        const sameKey = current.key === measurementKey;
        const heights = sameKey ? current.heights : { full: 0, compact: 0 };
        const fullContentHeight =
          density === "essential" || density === "full"
            ? next
            : sameKey
              ? current.fullContentHeight
              : 0;
        const fits = density === "essential" || heights[density] === fittingHeight;
        return sameKey && fits && current.fullContentHeight === fullContentHeight
          ? current
          : {
              key: measurementKey,
              heights: density === "essential" ? heights : { ...heights, [density]: fittingHeight },
              fullContentHeight,
            };
      });
    };
    measure();
    return observeResize(element, measure);
  }, [contentElement, density, measurementKey, minimized]);
  const card = (
    <div
      className={cn(
        "dropdown-glass isolate contain-paint grid max-h-full grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl",
        mode === "popover" &&
          "max-h-[min(calc(100dvh-6.5rem),calc(var(--available-height,100dvh)-1rem))]",
      )}
      style={placement ? { maxHeight: height } : undefined}
      data-thread-details-card
    >
      <ScrollArea scrollFade className="min-h-0">
        <div ref={setContentElement}>
          {children(density)}
          <div className="border-t border-border/65 px-2 py-1">
            <Button
              size="xs"
              variant="ghost-muted"
              className="w-full justify-start"
              aria-pressed={minimized}
              onClick={() => setMinimized(!minimized)}
            >
              {minimized ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
              {minimized ? "Show all details" : "Show essentials only"}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
  return (
    <Popover
      handle={handle}
      open={mode === "popover" && popoverOpen}
      onOpenChange={(open, details) => {
        const target =
          details.reason === "focus-out"
            ? (details.event as FocusEvent).relatedTarget
            : details.reason === "outside-press"
              ? details.event.target
              : null;
        if (!open && target instanceof Element && target.closest("[data-thread-find-bar]")) {
          details.cancel();
          return;
        }
        useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", open);
      }}
    >
      {placement ? (
        inlineOpen ? (
          <aside
            aria-label="Thread details"
            // Slides down to make room for the find bar, but returns in the same frame
            // the bar closes: a floating preview below moves up at once and would
            // otherwise overlap the card mid-slide.
            className={cn(
              "absolute z-20",
              topInset > 0 &&
                "transition-[top] duration-150 ease-out motion-reduce:transition-none",
            )}
            // The width follows the CSS property so a drag resizes the card
            // without rendering; at rest the two agree.
            style={{
              right: placement.right,
              top: placement.y,
              width: `min(var(--thread-details-panel-width), ${placement.maxWidth}px)`,
              maxHeight: height,
            }}
            data-density={density}
            data-thread-details-panel="inline"
            data-max-width={placement.maxWidth}
          >
            {card}
            <ThreadDetailsColumnResizeHandle
              width={placement.width}
              maxWidth={placement.maxWidth}
            />
          </aside>
        ) : null
      ) : (
        <PopoverPopup
          anchor={anchor}
          align="end"
          // Lines the card up with the find bar: the panel pads its card by 8px.
          alignOffset={THREAD_DETAILS_CARD_GAP - 8}
          collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
          side="bottom"
          sideOffset={topInset}
          variant="panel"
          padding="none"
        >
          <div data-density={density} data-thread-details-panel="popover">
            {card}
          </div>
        </PopoverPopup>
      )}
    </Popover>
  );
}
