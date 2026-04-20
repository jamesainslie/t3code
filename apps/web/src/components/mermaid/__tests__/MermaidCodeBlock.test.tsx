import { describe, expect, it, vi } from "vitest";

// Mock mermaid so the MermaidDiagram import doesn't break in test.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>mock</svg>" }),
  },
}));

// Mock SuspenseShikiCodeBlock since it depends on Shiki highlighter internals.
vi.mock("../../ChatMarkdown", () => ({
  SuspenseShikiCodeBlock: ({ code }: { code: string }) => (
    <pre data-testid="shiki-block">{code}</pre>
  ),
  extractFenceLanguage: (className: string | undefined) => {
    const match = className?.match(/language-([^\s]+)/);
    return match?.[1] ?? "text";
  },
}));

import { renderToStaticMarkup } from "react-dom/server";
import { MermaidCodeBlock } from "../MermaidCodeBlock";

const DEFAULT_PROPS = {
  code: "graph TD; A-->B",
  theme: "light" as const,
  diffThemeName: "pierre-light" as const,
  isStreaming: false,
};

describe("MermaidCodeBlock", () => {
  it("renders the Preview tab as active by default", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    // The Preview button should have the foreground text color (active state).
    expect(html).toContain("Preview");
    expect(html).toContain("Source");
    // The wrapper should have the chat-markdown-codeblock class.
    expect(html).toContain("chat-markdown-codeblock");
  });

  it("renders both Preview and Source tab buttons", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    // Both tab buttons should be present.
    const previewCount = (html.match(/Preview/g) ?? []).length;
    const sourceCount = (html.match(/Source/g) ?? []).length;
    expect(previewCount).toBeGreaterThanOrEqual(1);
    expect(sourceCount).toBeGreaterThanOrEqual(1);
  });

  it("renders a copy button with 'Copy code' aria-label", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    expect(html).toContain('aria-label="Copy code"');
  });

  it("renders the copy button with the chat-markdown-copy-button class", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    expect(html).toContain("chat-markdown-copy-button");
  });

  it("renders the MermaidDiagram in preview mode (initial SSR is empty)", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    // MermaidDiagram returns null in SSR (no effects), so no SVG content.
    // But the wrapper structure and tabs should still be there.
    expect(html).toContain("chat-markdown-codeblock");
    expect(html).toContain("Preview");
  });

  it("does not render the Shiki source block in preview mode", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    // In preview mode, the SuspenseShikiCodeBlock mock should not be rendered.
    expect(html).not.toContain("data-testid=\"shiki-block\"");
  });

  it("does not render the preview button as disabled initially", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    // The Preview button should not have the disabled attribute initially
    // because the diagram hasn't failed yet.
    // Check that the text-foreground class (active state) is applied to Preview.
    expect(html).toContain("text-foreground");
  });

  it("uses the correct wrapper class from the codeblock pattern", () => {
    const html = renderToStaticMarkup(<MermaidCodeBlock {...DEFAULT_PROPS} />);
    expect(html).toContain("chat-markdown-codeblock");
    expect(html).toContain("leading-snug");
  });

  it("renders with dark theme props without errors", () => {
    const html = renderToStaticMarkup(
      <MermaidCodeBlock
        {...DEFAULT_PROPS}
        theme="dark"
        diffThemeName="pierre-dark"
      />,
    );
    expect(html).toContain("Preview");
    expect(html).toContain("Source");
  });

  it("renders with isStreaming=true without errors", () => {
    const html = renderToStaticMarkup(
      <MermaidCodeBlock {...DEFAULT_PROPS} isStreaming={true} />,
    );
    expect(html).toContain("chat-markdown-codeblock");
  });
});
