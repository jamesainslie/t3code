import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocsFileTree } from "./DocsFileTree";
import type { ProjectFileEntry } from "@t3tools/contracts";

const entry = (path: string, oversized = false): ProjectFileEntry =>
  ({
    relativePath: path,
    size: 100,
    mtimeMs: 1,
    oversized,
  }) as ProjectFileEntry;

describe("DocsFileTree", () => {
  it("renders file names from snapshot entries", () => {
    const html = renderToStaticMarkup(
      <DocsFileTree
        files={[entry("README.md"), entry("docs/guide.md")]}
        selectedPath={null}
        onSelectFile={() => {}}
      />,
    );
    expect(html).toContain("README.md");
    expect(html).toContain("guide.md");
    expect(html).toContain("docs");
  });

  it("marks oversized files with data attribute", () => {
    const html = renderToStaticMarkup(
      <DocsFileTree files={[entry("big.md", true)]} selectedPath={null} onSelectFile={() => {}} />,
    );
    expect(html).toContain('data-oversized="true"');
  });

  it("highlights the selected file", () => {
    const html = renderToStaticMarkup(
      <DocsFileTree
        files={[entry("a.md"), entry("b.md")]}
        selectedPath="a.md"
        onSelectFile={() => {}}
      />,
    );
    expect(html).toContain('data-selected="true"');
  });

  it("shows empty state when no files", () => {
    const html = renderToStaticMarkup(
      <DocsFileTree files={[]} selectedPath={null} onSelectFile={() => {}} />,
    );
    expect(html).toContain("No markdown files found");
  });
});
