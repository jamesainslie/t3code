"use dom";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { renderMermaid } from "@t3tools/client-runtime/mermaid-renderer";
import { mermaidRepairPrompt } from "@t3tools/client-runtime/mermaid";
import { mountDiagramViewport } from "@t3tools/client-runtime/mermaid-viewport";

const buttonStyle: CSSProperties = {
  border: "1px solid #71717a",
  borderRadius: 8,
  padding: "10px 12px",
  background: "transparent",
  color: "inherit",
  font: "inherit",
};

export default function MermaidDom({
  source,
  theme,
  expanded,
  showSource,
  canRepair,
  onRepair,
}: {
  source: string;
  theme: "light" | "dark";
  expanded: boolean;
  showSource: boolean;
  canRepair: boolean;
  onRepair: (prompt: string) => Promise<void>;
  dom?: import("expo/dom").DOMProps;
}) {
  const [result, setResult] = useState<{
    source: string;
    theme: string;
    attempt: number;
    svg?: string;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [scale, setScale] = useState(1);
  const canvas = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const controls = useRef<ReturnType<typeof mountDiagramViewport> | null>(null);
  const current =
    result?.source === source && result.theme === theme && result.attempt === attempt
      ? result
      : null;
  const svg = current?.svg;
  const imageSource = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : undefined),
    [svg],
  );
  const error = current?.error;
  useEffect(() => {
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
            error: error instanceof Error ? error.message : "Unable to render the diagram.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, theme, attempt]);
  useEffect(() => {
    if (!expanded || !svg || showSource || !canvas.current || !image.current) return;
    const controller = mountDiagramViewport(canvas.current, image.current, svg, setScale);
    controls.current = controller;
    return () => {
      controller.dispose();
      controls.current = null;
    };
  }, [expanded, svg, showSource]);
  const background = theme === "dark" ? "#18181b" : "#ffffff";
  return (
    <div
      style={{
        height: "100dvh",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background,
        color: theme === "dark" ? "#e4e4e7" : "#27272a",
        font: "14px system-ui",
        overflow: "hidden",
      }}
    >
      <style>
        {
          "html,body,#root{margin:0;height:100%;} *{box-sizing:border-box} button:focus-visible{outline:2px solid #6489c6}"
        }
      </style>
      {expanded && svg && !showSource ? (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: 8 }}
        >
          <button
            style={buttonStyle}
            aria-label="Zoom out"
            onClick={() => controls.current?.zoom(1 / 1.2)}
          >
            -
          </button>
          <output aria-label="Zoom level" style={{ minWidth: 40, textAlign: "center" }}>
            {Math.round(scale * 100)}%
          </output>
          <button
            style={buttonStyle}
            aria-label="Zoom in"
            onClick={() => controls.current?.zoom(1.2)}
          >
            +
          </button>
          <button style={buttonStyle} onClick={() => controls.current?.fit()}>
            Fit
          </button>
          <button style={buttonStyle} onClick={() => controls.current?.center()}>
            Center
          </button>
          <button style={buttonStyle} onClick={() => controls.current?.actualSize()}>
            100%
          </button>
        </div>
      ) : null}
      {error || showSource ? (
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {error ? (
            <>
              <p role="status">Couldn’t render this diagram</p>
              <details>
                <summary>Error details</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{error}</pre>
              </details>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  style={buttonStyle}
                  onClick={() => {
                    setResult(null);
                    setAttempt((value) => value + 1);
                  }}
                >
                  Retry
                </button>
                {canRepair ? (
                  <button
                    style={buttonStyle}
                    onClick={() => void onRepair(mermaidRepairPrompt(source, error))}
                  >
                    Ask agent to fix
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            <code>{source}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          ref={canvas}
          tabIndex={expanded ? 0 : undefined}
          role="region"
          aria-label="Diagram canvas"
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            touchAction: expanded ? "none" : "pan-y",
            cursor: expanded ? "grab" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: expanded ? 0 : 16,
          }}
        >
          <img
            ref={image}
            src={imageSource}
            alt="Mermaid diagram"
            draggable={false}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      ) : (
        <p role="status" style={{ padding: 24, textAlign: "center" }}>
          Rendering diagram…
        </p>
      )}
      {expanded && !showSource ? (
        <p style={{ padding: "8px 16px", margin: 0, fontSize: 12, opacity: 0.7 }}>
          Drag to pan · Pinch to zoom · F fit · C center · 0 actual size
        </p>
      ) : null}
    </div>
  );
}
