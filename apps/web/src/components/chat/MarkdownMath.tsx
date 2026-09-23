import type { KatexOptions } from "katex";
import { Suspense, use, useMemo } from "react";

import { RenderErrorBoundary } from "../RenderErrorBoundary";

type RenderToString = (tex: string, options: KatexOptions) => string;

let katexPromise: Promise<RenderToString> | null = null;

// KaTeX and its stylesheet load on the first formula, not with the app.
export function loadKatex(): Promise<RenderToString> {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([katex]) => katex.default.renderToString,
    (error: unknown) => {
      katexPromise = null;
      throw error;
    },
  );
  return katexPromise;
}

function TypesetMath({ source, display }: { source: string; display: boolean }) {
  const renderToString = use(loadKatex());
  // `trust` stays off, so \href, \includegraphics and raw HTML commands render
  // as errors instead of markup. Invalid TeX shows in red rather than throwing.
  const html = useMemo(
    () => renderToString(source, { displayMode: display, throwOnError: false, strict: "ignore" }),
    [display, renderToString, source],
  );
  // Copying a formula yields its TeX, not KaTeX's glyph soup.
  return display ? (
    <div
      className="chat-markdown-math"
      data-markdown-copy={`$$\n${source}\n$$\n\n`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <span data-markdown-copy={`$${source}$`} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

/** TeX from `$…$`, `$$…$$` or a ```math fence, typeset with KaTeX. */
export function MarkdownMath({ source, display }: { source: string; display: boolean }) {
  const fallback = display ? (
    <pre>
      <code>{source}</code>
    </pre>
  ) : (
    <code>{source}</code>
  );
  return (
    <RenderErrorBoundary resetKeys={[source]} fallback={fallback}>
      <Suspense fallback={fallback}>
        <TypesetMath source={source} display={display} />
      </Suspense>
    </RenderErrorBoundary>
  );
}
