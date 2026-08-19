import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MinusIcon, PlusIcon, ScanIcon, XIcon } from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import type { MermaidAppTheme } from "./mermaidClient";
import {
  fitScale,
  initialZoomState,
  panBy,
  zoomAtPoint,
  type ZoomState,
} from "./mermaidZoom.logic";
import "./mermaid.css";

const WHEEL_ZOOM_STEP = 1.1;
const BUTTON_ZOOM_STEP = 1.25;
const FIT_PADDING_PX = 48;

interface MermaidZoomOverlayProps {
  source: string;
  theme: MermaidAppTheme;
  onClose: () => void;
}

export function MermaidZoomOverlay({ source, theme, onClose }: MermaidZoomOverlayProps) {
  const [zoom, setZoom] = useState<ZoomState>(initialZoomState);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);
  const didAutoFitRef = useRef(false);

  // Wheel and fit handlers need the latest zoom without re-binding a
  // non-passive listener per state change.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const svgElement = viewport?.querySelector("svg");
    if (!viewport || !svgElement) {
      return false;
    }
    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = svgElement.getBoundingClientRect();
    if (contentRect.width <= 0 || contentRect.height <= 0) {
      return false;
    }
    // Bounding rects reflect the current transform; normalize to scale 1.
    const currentScale = zoomRef.current.scale;
    const contentWidth = contentRect.width / currentScale;
    const contentHeight = contentRect.height / currentScale;
    const scale = fitScale(
      contentWidth,
      contentHeight,
      viewportRect.width,
      viewportRect.height,
      FIT_PADDING_PX,
    );
    setZoom({
      scale,
      x: (viewportRect.width - contentWidth * scale) / 2,
      y: (viewportRect.height - contentHeight * scale) / 2,
    });
    return true;
  }, []);

  // Auto-fit once the diagram's svg exists (it renders asynchronously).
  const handleDiagramLayout = useCallback(() => {
    if (didAutoFitRef.current) {
      return;
    }
    if (fitToViewport()) {
      didAutoFitRef.current = true;
    }
  }, [fitToViewport]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    let attempts = 0;
    let frame = 0;
    const tryFit = () => {
      attempts += 1;
      handleDiagramLayout();
      if (!didAutoFitRef.current && attempts < 60) {
        frame = requestAnimationFrame(tryFit);
      }
    };
    frame = requestAnimationFrame(tryFit);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [handleDiagramLayout]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      setZoom(
        zoomAtPoint(zoomRef.current, factor, event.clientX - rect.left, event.clientY - rect.top),
      );
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    setZoom((state) => panBy(state, dx, dy));
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }, []);

  const zoomFromCenter = useCallback((factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const rect = viewport.getBoundingClientRect();
    setZoom(zoomAtPoint(zoomRef.current, factor, rect.width / 2, rect.height / 2));
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex flex-col bg-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Diagram viewer"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs text-muted-foreground">Diagram · scroll to zoom, drag to pan</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="mermaid-overlay-button"
            onClick={() => zoomFromCenter(1 / BUTTON_ZOOM_STEP)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <MinusIcon className="size-3" />
          </button>
          <button
            type="button"
            className="mermaid-overlay-button"
            onClick={() => zoomFromCenter(BUTTON_ZOOM_STEP)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <PlusIcon className="size-3" />
          </button>
          <button
            type="button"
            className="mermaid-overlay-button"
            onClick={() => {
              fitToViewport();
            }}
            title="Fit to screen"
            aria-label="Fit to screen"
          >
            <ScanIcon className="size-3" />
          </button>
          <button
            type="button"
            className="mermaid-overlay-button"
            onClick={onClose}
            title="Close"
            aria-label="Close diagram viewer"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className="relative flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <MermaidDiagram source={source} theme={theme} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
