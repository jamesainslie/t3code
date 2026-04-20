import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { MermaidDiagram } from "./MermaidDiagram";
import type { DiffThemeName } from "../../lib/diffRendering";
import { SuspenseShikiCodeBlock } from "../ChatMarkdown";

type TabId = "preview" | "source";

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
  const [activeTab, setActiveTab] = useState<TabId>("preview");
  const [diagramFailed, setDiagramFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When diagram fails to render, auto-switch to source tab.
  const handleDiagramError = useCallback(() => {
    setDiagramFailed(true);
    setActiveTab("source");
  }, []);

  // Reset error state when code changes (new code might be valid).
  useEffect(() => {
    setDiagramFailed(false);
    setActiveTab("preview");
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

  return (
    <div className="chat-markdown-codeblock leading-snug">
      <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
        <div className="flex items-center rounded-md bg-background/60 backdrop-blur-sm">
          <button
            type="button"
            className={`px-2 py-0.5 text-xs transition-colors ${
              activeTab === "preview"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
            onClick={() => {
              if (!diagramFailed) setActiveTab("preview");
            }}
            disabled={diagramFailed}
          >
            Preview
          </button>
          <button
            type="button"
            className={`px-2 py-0.5 text-xs transition-colors ${
              activeTab === "source"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/70"
            }`}
            onClick={() => setActiveTab("source")}
          >
            Source
          </button>
        </div>
        <button
          type="button"
          className="chat-markdown-copy-button relative"
          onClick={handleCopy}
          title={copied ? "Copied" : "Copy code"}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>

      {activeTab === "preview" ? (
        <MermaidDiagram source={code} theme={theme} onError={handleDiagramError} />
      ) : (
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
      )}
    </div>
  );
}
