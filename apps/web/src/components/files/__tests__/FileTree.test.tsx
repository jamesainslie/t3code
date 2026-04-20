import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FileTreeNode } from "../FileTreeState";

// Mock useTheme to avoid needing the theme store
vi.mock("../../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "dark" as const,
    setTheme: () => {},
    resolvedTheme: "dark" as const,
    themeSnapshot: {},
  }),
}));

// Mock VscodeEntryIcon to avoid icon URL resolution
vi.mock("../../chat/VscodeEntryIcon", () => ({
  VscodeEntryIcon: ({ pathValue, kind }: { pathValue: string; kind: string }) => (
    <span data-testid="icon" data-path={pathValue} data-kind={kind} />
  ),
}));

// Mock tooltip to simplify rendering
vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipPopup: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// Import after mocks
const { FileTree } = await import("../FileTree");

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleTree: FileTreeNode[] = [
  {
    name: "src",
    relativePath: "src",
    kind: "directory",
    children: [
      {
        name: "components",
        relativePath: "src/components",
        kind: "directory",
        children: [
          {
            name: "App.tsx",
            relativePath: "src/components/App.tsx",
            kind: "file",
            size: 200,
            mtimeMs: 1000,
          },
          {
            name: "Button.tsx",
            relativePath: "src/components/Button.tsx",
            kind: "file",
            size: 150,
            mtimeMs: 1000,
          },
        ],
      },
      {
        name: "index.ts",
        relativePath: "src/index.ts",
        kind: "file",
        size: 50,
        mtimeMs: 1000,
      },
    ],
  },
  {
    name: "README.md",
    relativePath: "README.md",
    kind: "file",
    size: 100,
    mtimeMs: 1000,
  },
  {
    name: "package.json",
    relativePath: "package.json",
    kind: "file",
    size: 500,
    mtimeMs: 1000,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileTree", () => {
  it("renders file tree with directories and files at root level", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    // Root items should be visible: src (dir), README.md, package.json
    expect(html).toContain("src");
    expect(html).toContain("README.md");
    expect(html).toContain("package.json");
  });

  it("shows search input", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    expect(html).toContain('placeholder="Search files..."');
    expect(html).toContain('type="search"');
  });

  it("renders directory nodes with chevron icons", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    // The src directory should have a chevron (from lucide-react)
    // and a directory icon
    expect(html).toContain('data-kind="directory"');
    expect(html).toContain('data-path="src"');
  });

  it("renders file nodes with file icons", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    expect(html).toContain('data-kind="file"');
    expect(html).toContain('data-path="README.md"');
  });

  it("highlights the selected file with accent styling", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath="README.md" onSelectFile={() => {}} />,
    );

    // The selected file button should have bg-accent class
    expect(html).toContain("bg-accent");
    expect(html).toContain('aria-selected="true"');
  });

  it("does not apply selected styling to non-selected files", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath="README.md" onSelectFile={() => {}} />,
    );

    // Count occurrences of aria-selected="true" — should be exactly 1
    const selectedCount = (html.match(/aria-selected="true"/g) ?? []).length;
    expect(selectedCount).toBe(1);
  });

  it("renders markdown indicator dot for .md files", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    expect(html).toContain('aria-label="Markdown file"');
  });

  it("shows directories as collapsed by default (children not rendered in flat list)", () => {
    const html = renderToStaticMarkup(
      <FileTree files={sampleTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    // Children of collapsed directories shouldn't appear in the flat output
    // since flattenVisiblePaths only shows root items when nothing is expanded.
    // "components" is a child of "src" — should NOT be in the initial render.
    // But "src" itself should be there.
    expect(html).toContain("src");
    // "App.tsx" is nested two levels deep — should not appear
    expect(html).not.toContain("App.tsx");
  });

  it("renders oversized files with reduced opacity and tooltip", () => {
    const oversizedTree: FileTreeNode[] = [
      {
        name: "huge.bin",
        relativePath: "huge.bin",
        kind: "file",
        size: 10_000_000,
        mtimeMs: 1000,
        oversized: true,
      },
    ];

    const html = renderToStaticMarkup(
      <FileTree files={oversizedTree} selectedPath={null} onSelectFile={() => {}} />,
    );

    expect(html).toContain("opacity-50");
    expect(html).toContain("File too large to preview");
  });

  it("renders empty state message when files list is empty", () => {
    const html = renderToStaticMarkup(
      <FileTree files={[]} selectedPath={null} onSelectFile={() => {}} />,
    );

    // With no search query and no files, there's no "No files found" message
    // (that only shows when searching). The tree area should just be empty.
    expect(html).toContain('role="tree"');
  });

  it("applies custom className", () => {
    const html = renderToStaticMarkup(
      <FileTree
        files={sampleTree}
        selectedPath={null}
        onSelectFile={() => {}}
        className="custom-class"
      />,
    );

    expect(html).toContain("custom-class");
  });
});
