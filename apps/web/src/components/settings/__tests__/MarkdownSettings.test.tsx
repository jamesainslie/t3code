// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownSettings } from "../MarkdownSettings";

describe("MarkdownSettings", () => {
  it("renders MD Review renderer controls", () => {
    const html = renderToStaticMarkup(<MarkdownSettings />);

    expect(html).toContain("Markdown Renderer");
    expect(html).toContain("Theme");
    expect(html).toContain("Code line numbers");
    expect(html).toContain("Table of contents");
    expect(html).toContain("Comment author");
  });
});
