import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MdreviewAdapters } from "@t3tools/mdreview-host";

import { isMarkdownFile, FileViewer } from "../FileViewer";
import { formatFileSize, FileViewerToolbar } from "../FileViewerToolbar";

// ---------------------------------------------------------------------------
// Mock external dependencies that touch browser/async APIs
// ---------------------------------------------------------------------------

vi.mock("../../../localApi", () => ({
  readLocalApi: vi.fn(() => undefined),
}));

vi.mock("../../../editorPreferences", () => ({
  openInPreferredEditor: vi.fn(() => Promise.resolve("vscode")),
}));

// Mock useTheme so SSR rendering doesn't fail on useSyncExternalStore
vi.mock("../../../hooks/useTheme", () => ({
  useTheme: () => ({
    theme: "dark" as const,
    setTheme: () => {},
    resolvedTheme: "dark" as const,
    themeSnapshot: {},
  }),
}));

// Mock the Shiki highlighter — it loads WASM and can't run in Node
vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter: vi.fn(() =>
    Promise.resolve({
      codeToHtml: (_code: string, _opts: unknown) =>
        '<pre class="shiki"><code>highlighted</code></pre>',
    }),
  ),
}));

vi.mock("@t3tools/mdreview-host", () => ({
  MdreviewRenderer: ({
    filePath,
    source,
    theme,
  }: {
    filePath?: string;
    source: string;
    theme?: string;
  }) => (
    <div
      className="mdreview-host-root"
      data-file-path={filePath}
      data-theme={theme}
      data-testid="mdreview-renderer"
    >
      <h1>{source.replace(/^#\s*/, "")}</h1>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isMarkdownFile
// ---------------------------------------------------------------------------

describe("isMarkdownFile", () => {
  it("returns true for .md extension", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("docs/guide.md")).toBe(true);
  });

  it("returns true for .markdown extension", () => {
    expect(isMarkdownFile("notes.markdown")).toBe(true);
    expect(isMarkdownFile("deep/path/file.markdown")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isMarkdownFile("FILE.MD")).toBe(true);
    expect(isMarkdownFile("notes.Markdown")).toBe(true);
  });

  it("returns false for non-markdown extensions", () => {
    expect(isMarkdownFile("app.ts")).toBe(false);
    expect(isMarkdownFile("config.json")).toBe(false);
    expect(isMarkdownFile("index.html")).toBe(false);
    expect(isMarkdownFile("style.css")).toBe(false);
  });

  it("returns false for files with no extension", () => {
    expect(isMarkdownFile("Makefile")).toBe(false);
    expect(isMarkdownFile("Dockerfile")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe("formatFileSize", () => {
  it("formats bytes below 1024 as 'N B'", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats bytes below 1MB as 'N.N KB'", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10240)).toBe("10.0 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats bytes at or above 1MB as 'N.N MB'", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(100 * 1024 * 1024)).toBe("100.0 MB");
  });
});

// ---------------------------------------------------------------------------
// FileViewerToolbar (SSR rendering)
// ---------------------------------------------------------------------------

describe("FileViewerToolbar", () => {
  it("renders the file path in the toolbar", () => {
    const html = renderToStaticMarkup(
      <FileViewerToolbar
        relativePath="src/index.ts"
        size={2048}
        mtimeMs={Date.now()}
        cwd="/home/user/project"
      />,
    );
    expect(html).toContain("src/index.ts");
  });

  it("renders the formatted file size", () => {
    const html = renderToStaticMarkup(
      <FileViewerToolbar relativePath="app.tsx" size={3072} mtimeMs={Date.now()} cwd="/project" />,
    );
    expect(html).toContain("3.0 KB");
  });

  it("renders the Open in Editor button", () => {
    const html = renderToStaticMarkup(
      <FileViewerToolbar relativePath="main.go" size={100} mtimeMs={Date.now()} cwd="/project" />,
    );
    expect(html).toContain("Open in Editor");
    expect(html).toContain("lucide-external-link");
  });

  it("renders the Copy Path button", () => {
    const html = renderToStaticMarkup(
      <FileViewerToolbar
        relativePath="lib/utils.ts"
        size={256}
        mtimeMs={Date.now()}
        cwd="/project"
      />,
    );
    expect(html).toContain("Copy Path");
    expect(html).toContain("lucide-copy");
  });
});

// ---------------------------------------------------------------------------
// FileViewer rendering modes
// ---------------------------------------------------------------------------

describe("FileViewer", () => {
  it("renders markdown content via MdreviewRenderer when path ends in .md", () => {
    const html = renderToStaticMarkup(
      <FileViewer
        relativePath="docs/README.md"
        contents="# Hello World"
        size={14}
        mtimeMs={Date.now()}
        cwd="/project"
      />,
    );

    expect(html).toContain("mdreview-renderer");
    expect(html).toContain("mdreview-host-root");
    expect(html).toContain("<h1>Hello World</h1>");
    // Should NOT have shiki-related output
    expect(html).not.toContain("file-viewer-shiki");
  });

  it("enables MD Review comments when markdown adapters are provided", () => {
    const markdownAdapters = {
      file: {},
      storage: {},
      messaging: {},
    } as unknown as MdreviewAdapters;

    const html = renderToStaticMarkup(
      <FileViewer
        relativePath="docs/README.md"
        contents="# Hello World"
        size={14}
        mtimeMs={Date.now()}
        cwd="/project"
        markdownAdapters={markdownAdapters}
      />,
    );

    expect(html).toContain('data-file-path="docs/README.md"');
  });

  it("renders code content with Shiki fallback for .ts files", () => {
    const html = renderToStaticMarkup(
      <FileViewer
        relativePath="src/app.ts"
        contents="const x = 1;"
        size={12}
        mtimeMs={Date.now()}
        cwd="/project"
      />,
    );

    // Shiki requires async loading via use() which won't resolve in SSR.
    // The Suspense fallback renders a plain <pre><code> block.
    expect(html).toContain("const x = 1;");
    // Should NOT render the markdown renderer
    expect(html).not.toContain("chat-markdown");
  });

  it("includes the toolbar with file path and size", () => {
    const html = renderToStaticMarkup(
      <FileViewer
        relativePath="config/settings.json"
        contents='{"key": "value"}'
        size={16384}
        mtimeMs={Date.now()}
        cwd="/project"
      />,
    );

    expect(html).toContain("config/settings.json");
    expect(html).toContain("16.0 KB");
  });

  it("applies custom className to the outer container", () => {
    const html = renderToStaticMarkup(
      <FileViewer
        relativePath="file.txt"
        contents="hello"
        size={5}
        mtimeMs={Date.now()}
        cwd="/project"
        className="custom-wrapper"
      />,
    );

    expect(html).toContain("custom-wrapper");
  });
});
