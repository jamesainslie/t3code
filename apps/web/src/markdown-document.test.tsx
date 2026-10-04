import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vite-plus/test";

import {
  advanceDocumentSections,
  parseInlineCodeLanguage,
  rehypeSourceLines,
  remarkHeadingIds,
  sourceLinesBetween,
  splitMarkdownDocument,
  type MarkdownDocumentSection,
} from "./markdown-document";

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

describe("rehypeSourceLines", () => {
  function renderWithLines(markdown: string): string {
    return renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSourceLines]}>
        {markdown}
      </ReactMarkdown>,
    );
  }

  it("stamps each block with the source lines it came from", () => {
    const html = renderWithLines("# Title\n\nFirst line\nsecond line\n\n- one\n- two");

    expect(html).toContain('<h1 data-source-start="1" data-source-end="1">');
    expect(html).toContain('<p data-source-start="3" data-source-end="4">');
    expect(html).toContain('<li data-source-start="7" data-source-end="7">');
  });

  it("leaves inline elements unstamped", () => {
    const html = renderWithLines("Some **bold** and `code`.");

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });
});

describe("splitMarkdownDocument", () => {
  const sectioned = { wholeMaxLength: 0, sectionLength: 1 };

  function renderDocument(markdown: string, section?: MarkdownDocumentSection): string {
    return renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [remarkHeadingIds, { precedingHeadings: section?.precedingHeadings ?? [] }],
        ]}
        rehypePlugins={[[rehypeSourceLines, { firstLine: section?.startLine ?? 1 }]]}
      >
        {markdown}
      </ReactMarkdown>,
    );
  }

  function renderSections(sections: ReadonlyArray<MarkdownDocumentSection>): string {
    // A section of only definitions renders nothing; the page joins sections with
    // the same newline the whole document puts between its blocks.
    return sections
      .map((section) => renderDocument(section.text, section))
      .filter((html) => html.length > 0)
      .join("\n");
  }

  it("keeps a document under the limit whole", () => {
    expect(splitMarkdownDocument("# One\n\nText\n\n# Two\n")).toEqual([
      { text: "# One\n\nText\n\n# Two\n", offset: 0, startLine: 1, precedingHeadings: [] },
    ]);
  });

  it("cuts a long document between top-level blocks and records where each section starts", () => {
    const markdown = "# One\n\nFirst paragraph\nstill first\n\n## Two\n\nSecond\n";
    const sections = splitMarkdownDocument(markdown, sectioned);

    expect(sections.map(({ text, offset, startLine }) => ({ text, offset, startLine }))).toEqual([
      { text: "# One\n\n", offset: 0, startLine: 1 },
      { text: "First paragraph\nstill first\n\n", offset: 7, startLine: 3 },
      { text: "## Two\n\n", offset: 36, startLine: 6 },
      { text: "Second\n", offset: 44, startLine: 8 },
    ]);
  });

  it("grows a section to the target length before cutting", () => {
    const markdown = "Alpha\n\nBravo\n\nCharlie\n\nDelta\n";
    const sections = splitMarkdownDocument(markdown, { wholeMaxLength: 0, sectionLength: 12 });

    expect(sections.map((section) => section.text)).toEqual([
      "Alpha\n\nBravo\n\n",
      "Charlie\n\nDelta\n",
    ]);
  });

  it("never cuts through a block that spans blank lines", () => {
    const blocks = [
      "```md\n# not a heading\n\nstill code\n```",
      "~~~~\n```\n\nstill code\n~~~~",
      "$$\nx = 1\n\ny = 2\n$$",
      "<!-- hidden\n\nstill hidden -->",
      "<details>\n<summary>More</summary>\n\nInside\n\n</details>",
    ];
    for (const block of blocks) {
      const sections = splitMarkdownDocument(`Before\n\n${block}\n\nAfter\n`, sectioned);

      expect(sections.map((section) => section.text)).toEqual([
        "Before\n\n",
        `${block}\n\n`,
        "After\n",
      ]);
    }
  });

  it("keeps a list with what precedes it, since its items can continue an earlier list", () => {
    const list = "- one\n\n- two\n\n1. three\n\n2) four";
    const sections = splitMarkdownDocument(`Before\n\n${list}\n\nAfter\n`, sectioned);

    expect(sections.map((section) => section.text)).toEqual([`Before\n\n${list}\n\n`, "After\n"]);
  });

  it("carries the headings before each section so repeated anchors keep counting", () => {
    const markdown =
      "# Setup\n\n```sh\n# Setup\n```\n\n## The `code` **Setup**\n\n> ## Quoted\n\n## Setup ##\n";
    const sections = splitMarkdownDocument(markdown, sectioned);

    expect(sections.at(-1)?.precedingHeadings).toEqual(["Setup", "The code Setup", "Quoted"]);
    expect(renderSections(sections)).toContain('<h2 id="setup-1"');
  });

  it("gives every section the document's link reference definitions", () => {
    const markdown = "See [the docs][docs].\n\nAnd [again][docs].\n\n[docs]: https://example.com\n";
    const sections = splitMarkdownDocument(markdown, sectioned);

    expect(sections[1]?.text).toBe("And [again][docs].\n\n\n\n[docs]: https://example.com\n");
    expect(renderSections(sections)).toBe(renderDocument(markdown));
  });

  it("renders section by section exactly as it renders whole", () => {
    const markdown = [
      "# Spec",
      "",
      "## Purpose and scope",
      "",
      "Intro with `code` and a [link](#purpose-and-scope-1).",
      "",
      "- [ ] task one",
      "- [x] task two",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```go",
      "func main() {}",
      "",
      "// done",
      "```",
      "",
      "## Purpose and scope",
      "",
      "> quoted",
      "",
      "Closing words.",
      "",
    ].join("\n");
    const sections = splitMarkdownDocument(markdown, sectioned);

    expect(sections.length).toBeGreaterThan(5);
    expect(sections.map((section) => section.text).join("")).toBe(markdown);
    expect(renderSections(sections)).toBe(renderDocument(markdown));
  });
});

describe("advanceDocumentSections", () => {
  const markdown = "# One\n\nAlpha\n\n# Two\n\nBravo\n";
  const sections = splitMarkdownDocument(markdown, { wholeMaxLength: 0, sectionLength: 1 });

  it("adds one section per step until the document is on screen", () => {
    let shown: ReadonlyArray<MarkdownDocumentSection> = sections.slice(0, 1);
    const steps: number[] = [];
    for (let next = advanceDocumentSections(shown, sections); next !== shown;) {
      shown = next;
      steps.push(shown.length);
      next = advanceDocumentSections(shown, sections);
    }

    expect(steps).toEqual([2, 3, 4]);
    expect(shown).toEqual(sections);
  });

  it("keeps unchanged sections and replaces the first changed one", () => {
    const edited = splitMarkdownDocument(markdown.replace("Bravo", "Bravo!"), {
      wholeMaxLength: 0,
      sectionLength: 1,
    });

    const next = advanceDocumentSections(sections, edited);

    expect(next.slice(0, 3).every((section, index) => section === sections[index])).toBe(true);
    expect(next[3]).toBe(edited[3]);
  });

  it("drops sections past a shortened document's end", () => {
    const shortened = splitMarkdownDocument("# One\n\nAlpha\n", {
      wholeMaxLength: 0,
      sectionLength: 1,
    });

    expect(advanceDocumentSections(sections, shortened)).toEqual(shortened);
  });
});

describe("sourceLinesBetween", () => {
  it("spans from the first block's start to the last block's end", () => {
    expect(sourceLinesBetween({ start: 3, end: 4 }, { start: 7, end: 9 })).toEqual({
      startLine: 3,
      endLine: 9,
    });
  });

  it("orders blocks and tolerates a missing end", () => {
    expect(sourceLinesBetween({ start: 7, end: 9 }, { start: 3, end: 4 })).toEqual({
      startLine: 3,
      endLine: 9,
    });
    expect(sourceLinesBetween({ start: 5, end: 6 }, null)).toEqual({ startLine: 5, endLine: 6 });
    expect(sourceLinesBetween(null, null)).toBeNull();
  });
});
