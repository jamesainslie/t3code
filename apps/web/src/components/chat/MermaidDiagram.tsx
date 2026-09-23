import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  ExpandIcon,
  NetworkIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { renderMermaid } from "@t3tools/client-runtime/mermaid-renderer";
import { mountDiagramViewport } from "@t3tools/client-runtime/mermaid-viewport";
import { mermaidRepairPrompt } from "@t3tools/client-runtime/mermaid";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle, DialogDescription, DialogTrigger } from "../ui/dialog";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";

function DiagramCanvas({ svg }: { svg: string }) {
  const imageSource = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    [svg],
  );
  const canvas = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const controls = useRef<ReturnType<typeof mountDiagramViewport> | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!canvas.current || !image.current) return;
    const controller = mountDiagramViewport(canvas.current, image.current, svg, setScale);
    controls.current = controller;
    canvas.current.focus({ preventScroll: true });
    return () => {
      controller.dispose();
      controls.current = null;
    };
  }, [svg]);
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2"
        aria-label="Diagram controls"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => controls.current?.zoom(1 / 1.2)}
        >
          <ZoomOutIcon />
        </Button>
        <output className="w-14 text-center text-xs tabular-nums" aria-label="Zoom level">
          {Math.round(scale * 100)}%
        </output>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => controls.current?.zoom(1.2)}
        >
          <ZoomInIcon />
        </Button>
        <span className="mx-2 h-4 border-l border-border" />
        <Button variant="ghost" size="sm" onClick={() => controls.current?.fit()}>
          Fit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => controls.current?.center()}>
          Center
        </Button>
        <Button variant="ghost" size="sm" onClick={() => controls.current?.actualSize()}>
          100%
        </Button>
      </div>
      <div
        ref={canvas}
        tabIndex={0}
        role="region"
        aria-label="Diagram canvas"
        aria-describedby="mermaid-viewer-help"
        className="relative min-h-0 flex-1 touch-none cursor-grab overflow-hidden bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <img ref={image} src={imageSource} alt="Mermaid diagram" draggable={false} />
      </div>
      <DialogDescription
        id="mermaid-viewer-help"
        className="border-t border-border px-4 py-3 text-xs"
      >
        Drag to pan · Scroll or pinch to zoom · Arrow keys to pan · + / - zoom · F fit · C center ·
        0 actual size · Esc close
      </DialogDescription>
    </>
  );
}

export const MermaidDiagram = memo(function MermaidDiagram({
  source,
  theme,
  pending,
  onRepair,
}: {
  source: string;
  theme: "dark" | "light";
  pending: boolean;
  onRepair?: ((prompt: string) => void) | undefined;
}) {
  const [result, setResult] = useState<{
    source: string;
    theme: string;
    attempt: number;
    svg?: string;
    error?: string;
  } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copiedSource, setCopiedSource] = useState<string | null>(null);
  const copied = copiedSource === source;
  const [copyError, setCopyError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (pending) return;
    let cancelled = false;
    void renderMermaid(source, theme).then(
      (svg) => {
        if (!cancelled) setResult({ source, theme, attempt, svg });
      },
      (error: unknown) => {
        if (!cancelled)
          setResult({
            source,
            theme,
            attempt,
            error: error instanceof Error ? error.message : "The diagram could not be rendered.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, theme, pending, attempt]);
  const current =
    result?.source === source && result.theme === theme && result.attempt === attempt
      ? result
      : null;
  const svg = current?.svg;
  const imageSource = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined),
    [svg],
  );
  const error = pending ? undefined : current?.error;
  const copy = async () => {
    try {
      await writeTextToClipboard(source);
      setCopiedSource(source);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };
  return (
    <div
      className="not-prose my-3 overflow-hidden rounded-xl border border-border bg-card"
      data-mermaid-diagram=""
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-1.5">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <NetworkIcon className="size-3.5" />
          Mermaid
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={showSource ? "View diagram" : "View source"}
            aria-pressed={showSource}
            onClick={() => setShowSource(!showSource)}
          >
            <CodeIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? "Source copied" : "Copy source"}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
          {svg && (
            <Dialog>
              <DialogTrigger
                render={<Button variant="ghost" size="sm" aria-label="Expand diagram" />}
              >
                <ExpandIcon />
                Expand
              </DialogTrigger>
              <DialogPopup
                className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden p-0"
                bottomStickOnMobile={false}
                initialFocus={false}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") event.stopPropagation();
                }}
              >
                <DialogTitle className="border-b border-border px-4 py-4 text-sm">
                  Mermaid diagram
                </DialogTitle>
                <DiagramCanvas svg={svg} />
              </DialogPopup>
            </Dialog>
          )}
        </div>
      </div>
      {copyError && (
        <p role="status" className="px-4 py-2 text-xs text-destructive">
          Could not copy. You can select the source below.
        </p>
      )}
      {error ? (
        <div className="space-y-3 p-4">
          <p className="text-sm font-medium">Couldn’t render this diagram</p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Error details</summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{error}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResult(null);
                setAttempt((value) => value + 1);
              }}
            >
              Retry
            </Button>
            {onRepair && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRepair(mermaidRepairPrompt(source, error))}
              >
                Ask agent to fix
              </Button>
            )}
          </div>
        </div>
      ) : !svg && !showSource ? (
        <div
          role="status"
          className="flex min-h-32 items-center justify-center p-6 text-xs text-muted-foreground"
        >
          {pending ? "Waiting for diagram…" : "Rendering diagram…"}
        </div>
      ) : null}
      {showSource || error || copyError ? (
        <pre className="m-0 max-h-96 overflow-auto border-t border-border bg-muted/30 p-4 text-xs">
          <code>{source}</code>
        </pre>
      ) : svg ? (
        <img
          className="mx-auto block max-h-[420px] max-w-full p-5"
          src={imageSource}
          alt="Mermaid diagram"
        />
      ) : null}
    </div>
  );
});
