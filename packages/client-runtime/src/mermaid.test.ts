import { describe, expect, it } from "vite-plus/test";
import { splitMermaidMarkdown, mermaidRepairPrompt } from "./mermaid.ts";

describe("Mermaid markdown", () => {
  it("includes the original source and error in a repair draft without breaking its fence", () => {
    const prompt = mermaidRepairPrompt("graph TD\n A[```]", "Parse error on line 2");
    expect(prompt).toContain("````mermaid\ngraph TD\n A[```]\n````");
    expect(prompt).toContain("Parse error on line 2");
  });
  it("preserves surrounding text and distinguishes complete diagrams from streamed fences", () => {
    const parts = splitMermaidMarkdown(
      "Before\n\n```Mermaid\ngraph TD\n A --> B\n```\nAfter\n~~~mermaid\nsequenceDiagram\n",
    );
    expect(parts).toEqual([
      { kind: "markdown", sourceOffset: 0, markdown: "Before\n\n" },
      { kind: "mermaid", sourceOffset: 8, source: "graph TD\n A --> B", complete: true },
      { kind: "markdown", sourceOffset: 40, markdown: "\nAfter\n" },
      { kind: "mermaid", sourceOffset: 47, source: "sequenceDiagram", complete: false },
    ]);
  });
  it("does not interpret Mermaid examples inside a longer code fence", () => {
    const markdown = "````markdown\n```mermaid\ngraph TD; A-->B\n```\n````";
    expect(splitMermaidMarkdown(markdown)).toEqual([
      { kind: "markdown", sourceOffset: 0, markdown },
    ]);
  });
  it("recognizes quoted fences, tilde fences and CRLF", () => {
    const parts = splitMermaidMarkdown("> ~~~mermaid\r\n> graph TD; A-->B\r\n> ~~~~");
    expect(parts).toContainEqual({
      kind: "mermaid",
      sourceOffset: 2,
      source: "graph TD; A-->B",
      complete: true,
    });
  });
  it("keeps a fence pending when Markdown treats its indented closing marker as code", () => {
    const parts = splitMermaidMarkdown("```mermaid\ngraph TD; A-->B\n    ```");
    expect(parts).toEqual([
      { kind: "mermaid", sourceOffset: 0, source: "graph TD; A-->B\n    ```", complete: false },
    ]);
  });
});
