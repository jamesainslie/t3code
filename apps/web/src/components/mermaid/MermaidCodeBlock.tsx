import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, Maximize2Icon } from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import { MermaidZoomOverlay } from "./MermaidZoomOverlay";
import {
  MERMAID_STREAM_SETTLE_MS,
  type MermaidTab,
  resolveMermaidView,
  summarizeMermaidError,
} from "./mermaidCodeBlock.logic";
import { useSettledValue } from "./useSettledValue";
import "./mermaid.css";
import type { DiffThemeName } from "../../lib/diffRendering";
import { SuspenseShikiCodeBlock } from "../ChatMarkdown";

interface MermaidCodeBlockProps {
  code: string;
  theme: "light" | "dark";
  diffThemeName: DiffThemeName;
  isStreaming: boolean;
}

export function MermaidCodeBlock({
  code,
  theme,
  diffThemeName,
  isStreaming,
}: MermaidCodeBlockProps) {
  const [activeTab, setActiveTab] = useState<MermaidTab>("preview");
  const [failure, setFailure] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // While streaming, only a source that has stopped changing for a quiet
  // period is handed to mermaid — a still-open fence keeps mutating every
  // token, so truncated diagrams are never rendered.
  const settledCode = useSettledValue(code, isStreaming ? MERMAID_STREAM_SETTLE_MS : 0);
  const isSettled = settledCode === code;

  const handleDiagramError = useCallback((message: string) => {
    setFailure(summarizeMermaidError(message));
    setExpanded(false);
  }, []);

  // New source may be valid again (streaming appended tokens, or the message
  // was regenerated) — clear the failure and retry.
  useEffect(() => {
    setFailure(null);
  }, [code]);

  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  const failed = failure != null;
  const view = resolveMermaidView({ activeTab, failed, isSettled });
  const displayTab: MermaidTab = view === "diagram" ? "preview" : "source";

  return (
    <div className="chat-markdown-codeblock leading-snug">
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
        <div className="flex items-center rounded-md bg-background/60 backdrop-blur-sm">
          <button
            type="button"
            className={`px-2 py-0.5 text-xs transition-colors ${
              displayTab === "preview"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
            onClick={() => {
              if (!failed) setActiveTab("preview");
            }}
            disabled={failed}
            title={failed ? `Diagram failed: ${failure}` : undefined}
          >
            Preview
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 text-xs transition-colors ${
              displayTab === "source"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
            onClick={() => setActiveTab("source")}
          >
            Source
          </button>
        </div>
        {view === "diagram" ? (
          <button
            type="button"
            className="mermaid-toolbar-button"
            onClick={() => setExpanded(true)}
            title="Expand diagram"
            aria-label="Expand diagram"
          >
            <Maximize2Icon className="size-3" />
          </button>
        ) : null}
        <button
          type="button"
          className="mermaid-toolbar-button"
          onClick={handleCopy}
          title={copied ? "Copied" : "Copy code"}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>

      {view === "diagram" ? (
        <MermaidDiagram source={code} theme={theme} onError={handleDiagramError} />
      ) : (
        <>
          {failed ? (
            <div className="px-3 pt-2 text-xs text-destructive">
              Diagram failed to render: {failure}
            </div>
          ) : null}
          <Suspense
            fallback={
              <pre>
                <code>{code}</code>
              </pre>
            }
          >
            <SuspenseShikiCodeBlock
              className="language-mermaid"
              code={code}
              themeName={diffThemeName}
              isStreaming={isStreaming}
            />
          </Suspense>
        </>
      )}

      {expanded && view === "diagram" ? (
        <MermaidZoomOverlay source={code} theme={theme} onClose={() => setExpanded(false)} />
      ) : null}
    </div>
  );
}
