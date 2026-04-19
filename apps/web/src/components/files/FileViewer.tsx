import {
  DiffsHighlighter,
  getSharedHighlighter,
  SupportedLanguages,
} from "@pierre/diffs";
import { MdreviewRenderer } from "@t3tools/mdreview-host";
import type { MdreviewAdapters } from "@t3tools/mdreview-host";
import React, {
  Suspense,
  memo,
  use,
  useEffect,
  useMemo,
  useRef,
} from "react";

import {
  resolveDiffThemeName,
  type DiffThemeName,
} from "../../lib/diffRendering";
import { fnv1a32 } from "../../lib/diffRendering";
import { LRUCache } from "../../lib/lruCache";
import { useTheme } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import { FileViewerToolbar } from "./FileViewerToolbar";

// ---------------------------------------------------------------------------
// Markdown detection
// ---------------------------------------------------------------------------

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

/**
 * Returns `true` when the file path ends with a markdown extension
 * (`.md` or `.markdown`), case-insensitive.
 */
export function isMarkdownFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return MARKDOWN_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

// ---------------------------------------------------------------------------
// File extension -> Shiki language
// ---------------------------------------------------------------------------

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".json": "json",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "fish",
  ".sql": "sql",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".svg": "xml",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".vue": "vue",
  ".svelte": "svelte",
  ".lua": "lua",
  ".php": "php",
  ".r": "r",
  ".dockerfile": "dockerfile",
  ".tf": "hcl",
  ".ini": "ini",
  ".gitignore": "ini",
};

function detectLanguage(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "text";
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? "text";
}

// ---------------------------------------------------------------------------
// Highlight caching (shared with ChatMarkdown pattern)
// ---------------------------------------------------------------------------

const MAX_HIGHLIGHT_CACHE_ENTRIES = 200;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 20 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

function createCacheKey(
  code: string,
  language: string,
  theme: DiffThemeName,
): string {
  return `fv:${fnv1a32(code).toString(36)}:${code.length}:${language}:${theme}`;
}

function estimateSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(
  language: string,
): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((err) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") throw err;
    return getHighlighterPromise("text");
  });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Code viewer (Shiki)
// ---------------------------------------------------------------------------

interface ShikiCodeViewProps {
  code: string;
  language: string;
  themeName: DiffThemeName;
}

function SuspenseShikiCodeView({
  code,
  language,
  themeName,
}: ShikiCodeViewProps) {
  const cacheKey = createCacheKey(code, language, themeName);
  const cachedHtml = highlightedCodeCache.get(cacheKey);

  if (cachedHtml != null) {
    return (
      <div
        className="file-viewer-shiki overflow-auto p-4 text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: cachedHtml }}
      />
    );
  }

  const highlighter = use(getHighlighterPromise(language));
  const highlightedHtml = useMemo(() => {
    try {
      return highlighter.codeToHtml(code, {
        lang: language,
        theme: themeName,
      });
    } catch {
      return highlighter.codeToHtml(code, {
        lang: "text",
        theme: themeName,
      });
    }
  }, [code, highlighter, language, themeName]);

  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;

  useEffect(() => {
    highlightedCodeCache.set(
      cacheKeyRef.current,
      highlightedHtml,
      estimateSize(highlightedHtml, code),
    );
  }, [highlightedHtml, code]);

  return (
    <div
      className="file-viewer-shiki overflow-auto p-4 text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: {
    fallback: React.ReactNode;
    children: React.ReactNode;
  }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function CodeFileViewer({
  contents,
  language,
  themeName,
}: {
  contents: string;
  language: string;
  themeName: DiffThemeName;
}) {
  const plainFallback = (
    <pre className="overflow-auto p-4 text-sm leading-relaxed whitespace-pre-wrap">
      <code>{contents}</code>
    </pre>
  );

  return (
    <CodeHighlightErrorBoundary fallback={plainFallback}>
      <Suspense fallback={plainFallback}>
        <SuspenseShikiCodeView
          code={contents}
          language={language}
          themeName={themeName}
        />
      </Suspense>
    </CodeHighlightErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Markdown viewer
// ---------------------------------------------------------------------------

/**
 * Noop adapters for the MdreviewRenderer. The file viewer only needs the
 * synchronous markdown-to-HTML conversion path; the adapter hooks are unused
 * but required by the component's type contract.
 */
const noopAdapters: MdreviewAdapters = {
  file: {
    writeFile: async () => ({ success: false, error: "noop" }),
    readFile: async () => "",
    checkChanged: async () => ({ changed: false }),
    watch: () => () => undefined,
  },
  storage: {
    getSync: async () => ({}),
    setSync: async () => undefined,
    getLocal: async () => ({}),
    setLocal: async () => undefined,
  },
  messaging: {
    send: async () => undefined,
  },
};

function MarkdownFileViewer({
  contents,
  theme,
}: {
  contents: string;
  theme: "light" | "dark";
}) {
  return (
    <div className="overflow-auto p-4">
      <MdreviewRenderer
        source={contents}
        adapters={noopAdapters}
        theme={theme}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileViewer (main export)
// ---------------------------------------------------------------------------

export interface FileViewerProps {
  /** File path relative to project root */
  relativePath: string;
  /** Raw file contents */
  contents: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  mtimeMs: number;
  /** Current project cwd (for "Open in Editor") */
  cwd: string;
  /** Optional className for outer container */
  className?: string;
}

function FileViewerImpl({
  relativePath,
  contents,
  size,
  mtimeMs,
  cwd,
  className,
}: FileViewerProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const language = useMemo(
    () => detectLanguage(relativePath),
    [relativePath],
  );
  const markdown = isMarkdownFile(relativePath);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
    >
      <FileViewerToolbar
        relativePath={relativePath}
        size={size}
        mtimeMs={mtimeMs}
        cwd={cwd}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {markdown ? (
          <MarkdownFileViewer
            contents={contents}
            theme={resolvedTheme}
          />
        ) : (
          <CodeFileViewer
            contents={contents}
            language={language}
            themeName={diffThemeName}
          />
        )}
      </div>
    </div>
  );
}

export const FileViewer = memo(FileViewerImpl);
