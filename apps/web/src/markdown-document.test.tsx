import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import { parseInlineCodeLanguage, remarkHeadingIds } from "./markdown-document";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkHeadingIds]}>{markdown}</ReactMarkdown>,
  );
}

describe("remarkHeadingIds", () => {
  it("gives headings GitHub's anchor slugs so table-of-contents links resolve", () => {
    const html = renderMarkdown(
      "## Phase 1: Foundation\n\n### API/Interface\n\n## Alternative 1: Keep State in the V1 Resource Groups",
    );

    expect(html).toContain('<h2 id="phase-1-foundation">');
    expect(html).toContain('<h3 id="apiinterface">');
    expect(html).toContain('<h2 id="alternative-1-keep-state-in-the-v1-resource-groups">');
  });

  it("numbers repeated headings the way GitHub does", () => {
    const html = renderMarkdown("## Setup\n\n## Setup\n\n## Setup");

    expect(html).toContain('id="setup"');
    expect(html).toContain('id="setup-1"');
    expect(html).toContain('id="setup-2"');
  });

  it("slugs the visible text of formatted headings", () => {
    const html = renderMarkdown("## The `code` and **bold** [link](https://example.com)");

    expect(html).toContain('id="the-code-and-bold-link"');
  });
});

describe("parseInlineCodeLanguage", () => {
  it("reads a trailing {:lang} marker off inline code", () => {
    expect(parseInlineCodeLanguage("const x = 1{:ts}")).toEqual({
      code: "const x = 1",
      language: "ts",
    });
    expect(parseInlineCodeLanguage("std::vector<int>{:c++}")).toEqual({
      code: "std::vector<int>",
      language: "c++",
    });
  });

  it("leaves inline code without a marker alone", () => {
    expect(parseInlineCodeLanguage("const x = 1")).toBeNull();
    expect(parseInlineCodeLanguage("{:ts}")).toBeNull();
    expect(parseInlineCodeLanguage("map{: ts}")).toBeNull();
  });
});
