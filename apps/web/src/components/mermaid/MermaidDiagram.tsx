import { memo, useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

let renderCounter = 0;

function getUniqueId(): string {
  renderCounter += 1;
  return `mermaid-diagram-${renderCounter}`;
}

interface MermaidDiagramProps {
  source: string;
  theme: "light" | "dark";
  onError?: () => void;
}

function MermaidDiagramInner({ source, theme, onError }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const idRef = useRef<string>(getUniqueId());
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const mermaidTheme = useMemo(() => (theme === "dark" ? "dark" : "default"), [theme]);

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      // Suppress mermaid's own error rendering — we handle errors ourselves.
      suppressErrorRendering: true,
    });

    const id = idRef.current;

    mermaid
      .render(id, source)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvg(null);
          setError(true);
          onErrorRef.current?.();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source, mermaidTheme]);

  if (error || svg == null) {
    return null;
  }

  return <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const MermaidDiagram = memo(
  MermaidDiagramInner,
  (prev, next) => prev.source === next.source && prev.theme === next.theme,
);
