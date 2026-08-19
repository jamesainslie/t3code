import { memo, useEffect, useRef, useState } from "react";
import { type MermaidAppTheme, renderMermaidDiagram } from "./mermaidClient";

let renderCounter = 0;

function getUniqueId(): string {
  renderCounter += 1;
  return `mermaid-diagram-${renderCounter}`;
}

interface MermaidDiagramProps {
  source: string;
  theme: MermaidAppTheme;
  onError?: (message: string) => void;
}

function MermaidDiagramInner({ source, theme, onError }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef<string>(getUniqueId());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;

    // The previous svg intentionally stays visible while the new source
    // renders, so theme switches and source edits do not flash a blank frame.
    renderMermaidDiagram(idRef.current, source, theme).then(
      (renderedSvg) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setFailed(false);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
          onErrorRef.current?.(cause instanceof Error ? cause.message : "Diagram failed to render");
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  if (failed) {
    return null;
  }

  if (svg == null) {
    return (
      <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }

  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const MermaidDiagram = memo(
  MermaidDiagramInner,
  (prev, next) => prev.source === next.source && prev.theme === next.theme,
);
