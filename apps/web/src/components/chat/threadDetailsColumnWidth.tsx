import * as Schema from "effect/Schema";
import { create } from "zustand";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import { THREAD_DETAILS_CARD_WIDTH } from "./threadDetailsCardLayout";

const STORAGE_KEY = "lathe:thread-details-column-width";
/** Sizes the inline details card, its popover and the find bar. */
const WIDTH_PROPERTY = "--thread-details-panel-width";
const WidthSchema = Schema.Finite;

function clampWidth(width: number) {
  return Math.round(
    Math.max(THREAD_DETAILS_CARD_WIDTH.min, Math.min(THREAD_DETAILS_CARD_WIDTH.max, width)),
  );
}

function readStoredWidth() {
  try {
    const stored = getLocalStorageItem(STORAGE_KEY, WidthSchema);
    return stored === null ? THREAD_DETAILS_CARD_WIDTH.default : clampWidth(stored);
  } catch (error) {
    console.error("Could not read the thread details column width.", error);
    return THREAD_DETAILS_CARD_WIDTH.default;
  }
}

function applyWidthProperty(width: number) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(WIDTH_PROPERTY, `${width}px`);
}

const useColumnWidthStore = create<{ readonly width: number }>(() => {
  const width = readStoredWidth();
  applyWidthProperty(width);
  return { width };
});

/**
 * The width a drag is showing. A drag only writes the CSS property each
 * frame, so the chat lane reflows once on release rather than every frame;
 * the side cards, which re-measure every frame, read it from here.
 */
let dragWidth: number | null = null;

export function useThreadDetailsColumnWidth() {
  return useColumnWidthStore((state) => state.width);
}

export function currentThreadDetailsColumnWidth() {
  return dragWidth ?? useColumnWidthStore.getState().width;
}

function commitWidth(next: number) {
  const width = clampWidth(next);
  applyWidthProperty(width);
  useColumnWidthStore.setState({ width });
  try {
    setLocalStorageItem(STORAGE_KEY, width, WidthSchema);
  } catch (error) {
    console.error("Could not persist the thread details column width.", error);
  }
}

/**
 * The left-edge grip on every card in the details column. Each card resizes
 * the whole column, since they share one width. Double-click restores the
 * default.
 */
export function ThreadDetailsColumnResizeHandle({
  width,
  maxWidth,
}: {
  /** The width the card is showing now, which a narrow canvas may hold below the chosen one. */
  readonly width: number;
  readonly maxWidth: number;
}) {
  const { refresh: _refresh, ...handlers } = useResizeDrag<HTMLDivElement>(() => ({
    width,
    edge: "left",
    resize(value) {
      const next = Math.round(Math.max(THREAD_DETAILS_CARD_WIDTH.min, Math.min(maxWidth, value)));
      dragWidth = next;
      applyWidthProperty(next);
      return next;
    },
    finish(finalWidth, moved) {
      if (moved) commitWidth(finalWidth);
      else applyWidthProperty(useColumnWidthStore.getState().width);
    },
    cleanup(committed) {
      dragWidth = null;
      if (!committed) applyWidthProperty(useColumnWidthStore.getState().width);
    },
  }));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the thread details column"
      className="group absolute inset-y-6 left-0 z-10 w-2 cursor-col-resize touch-none select-none"
      onDoubleClick={() => commitWidth(THREAD_DETAILS_CARD_WIDTH.default)}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0.5 w-px rounded-full bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
      />
    </div>
  );
}
