import {
  CommentManager,
  RenderPipeline,
  ThemeEngine,
  mermaidRenderer,
  type Preferences,
  type ThemeName,
} from "@mdreview/core";
import mdreviewContentCss from "@mdreview/core/styles/content.css?raw";
import type {
  FileAdapter as CoreFileAdapter,
  MessagingAdapter as CoreMessagingAdapter,
  StorageAdapter as CoreStorageAdapter,
} from "@mdreview/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MDREVIEW_PREFERENCES_CHANGED_EVENT, readMdreviewPreferences } from "./preferences.ts";

export interface MdreviewAdapters {
  readonly file: CoreFileAdapter;
  readonly storage: CoreStorageAdapter;
  readonly messaging: CoreMessagingAdapter;
}

export interface MdreviewRendererProps {
  /**
   * Raw markdown source. The renderer passes this through MD Review's render
   * pipeline and inserts the enhanced document into an isolated host element.
   */
  readonly source: string;
  /**
   * Platform adapters. Retained as a prop so future renderer features
   * (comment writes, theme persistence, live IPC) can reach through to the
   * host; the current implementation only needs identity-stable adapters so
   * the memoized converter doesn't churn.
   */
  readonly adapters: MdreviewAdapters;
  /**
   * Relative markdown path. When provided, MD Review comments are enabled and
   * persisted through the file adapter.
   */
  readonly filePath?: string | undefined;
  /**
   * Optional theme identifier, attached to the root element as `data-theme`.
   * Downstream CSS (mdview's content stylesheet) picks the appropriate
   * palette based on this attribute.
   */
  readonly theme?: string;
}

const MDREVIEW_THEME_NAMES = new Set<string>([
  "github-light",
  "github-dark",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "monokai",
  "monokai-pro",
  "one-dark-pro",
]);

function resolveMdreviewThemeName(theme: string | undefined): ThemeName {
  if (theme && MDREVIEW_THEME_NAMES.has(theme)) {
    return theme as ThemeName;
  }
  return theme === "dark" ? ("github-dark" as ThemeName) : ("github-light" as ThemeName);
}

function resolveActiveMdreviewThemeName(preferences: Preferences, fallback: ThemeName): ThemeName {
  if (!preferences.autoTheme) {
    return preferences.theme;
  }

  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  return prefersDark ? preferences.darkTheme : preferences.lightTheme || fallback;
}

function createScopedContentCss(css: string): string {
  return css
    .replaceAll(":root", ":host, .mdreview-shadow-document")
    .replaceAll("body.mdreview-active", ".mdreview-shadow-document.mdreview-active");
}

const scopedContentCss = `${createScopedContentCss(mdreviewContentCss)}

:host {
  display: block;
  width: 100%;
  min-width: 0;
  color: var(--md-fg);
}

.mdreview-shadow-document.mdreview-active {
  margin: 0 !important;
  padding: 0;
  width: 100% !important;
  max-width: none !important;
  min-width: 0;
  min-height: 100%;
  overflow-wrap: anywhere;
  background: transparent;
}

#mdreview-container {
  box-sizing: border-box;
  width: 100% !important;
  max-width: none !important;
  margin: 0 !important;
  margin-right: 0 !important;
  margin-left: 0 !important;
  padding: 0 !important;
  padding-bottom: 0;
}
`;

function ensureShadowRoot(host: HTMLElement): ShadowRoot {
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}

function ensureGlobalCommentStyles() {
  if (document.getElementById("t3-mdreview-comment-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "t3-mdreview-comment-styles";
  style.textContent = mdreviewContentCss;
  document.head.append(style);
}

function getSelectionTextWithin(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const ancestor =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

  if (!(ancestor instanceof Node) || !container.contains(ancestor)) {
    return null;
  }

  const selectedText = selection.toString().trim();
  return selectedText.length > 0 ? selectedText : null;
}

function findRenderedContainer(
  host: HTMLElement,
  filePath: string | undefined,
): HTMLElement | null {
  return filePath
    ? host.querySelector<HTMLElement>("#mdreview-container")
    : (host.shadowRoot?.querySelector<HTMLElement>("#mdreview-container") ?? null);
}

/**
 * React 19 component that renders a markdown string as HTML using the same
 * rendering engine as the mdview browser extension and Electron app. It embeds
 * mdreview into a shadow root so the library's document-level stylesheet
 * (`body.mdreview-active`, `#mdreview-container`) has a local document shape
 * without restyling the T3 app shell.
 *
 * The renderer uses MD Review's full render pipeline so persisted preferences
 * such as line numbers, HTML rendering, TOC handling, code block controls, and
 * Mermaid enhancement match the upstream renderer behavior.
 */
export function MdreviewRenderer(props: MdreviewRendererProps): React.ReactElement {
  const { source, adapters, filePath, theme } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const commentManagerRef = useRef<CommentManager | null>(null);
  const [preferencesRevision, setPreferencesRevision] = useState(0);
  const [renderedSnapshot, setRenderedSnapshot] = useState<{
    readonly id: number;
    readonly source: string;
    readonly themeName: ThemeName;
  } | null>(null);
  const themeName = useMemo(() => resolveMdreviewThemeName(theme), [theme]);

  useEffect(() => {
    const bumpPreferencesRevision = () => setPreferencesRevision((value) => value + 1);
    const handleStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("t3code:mdreview:")) {
        bumpPreferencesRevision();
      }
    };

    window.addEventListener(MDREVIEW_PREFERENCES_CHANGED_EVENT, bumpPreferencesRevision);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(MDREVIEW_PREFERENCES_CHANGED_EVENT, bumpPreferencesRevision);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setRenderedSnapshot(null);

    const style = document.createElement("style");
    style.textContent = scopedContentCss;

    const documentRoot = document.createElement("div");
    documentRoot.className = "mdreview-shadow-document mdreview-active";
    documentRoot.setAttribute("data-theme", themeName);

    const container = document.createElement("div");
    container.id = "mdreview-container";
    container.className = "mdreview-rendered";

    documentRoot.append(container);
    if (filePath) {
      host.replaceChildren(style, documentRoot);
      return;
    }

    const shadowRoot = ensureShadowRoot(host);
    shadowRoot.replaceChildren(style, documentRoot);
  }, [filePath, themeName]);

  useEffect(() => {
    const host = hostRef.current;
    const container = host ? findRenderedContainer(host, filePath) : null;
    if (!container) {
      return;
    }

    let cancelled = false;
    const pipeline = new RenderPipeline({ messaging: adapters.messaging });

    setRenderedSnapshot(null);
    void (async () => {
      const preferences = await readMdreviewPreferences(adapters.storage);
      const activeThemeName = resolveActiveMdreviewThemeName(preferences, themeName);
      await pipeline.render({
        container,
        markdown: source,
        theme: activeThemeName,
        filePath: filePath ?? "",
        preferences,
        useCache: false,
        useWorkers: false,
      });

      if (!cancelled) {
        setRenderedSnapshot((snapshot) => ({
          id: (snapshot?.id ?? 0) + 1,
          source,
          themeName: activeThemeName,
        }));
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      container.textContent =
        error instanceof Error
          ? `Failed to render markdown: ${error.message}`
          : "Failed to render markdown.";
    });

    return () => {
      cancelled = true;
      pipeline.cancelRender();
    };
  }, [adapters.messaging, adapters.storage, filePath, preferencesRevision, source, themeName]);

  useEffect(() => {
    if (!filePath || !renderedSnapshot) {
      return;
    }

    const host = hostRef.current;
    const container = host ? findRenderedContainer(host, filePath) : null;
    if (!host || !container) {
      return;
    }

    ensureGlobalCommentStyles();
    const commentManager = new CommentManager({ file: adapters.file });
    commentManagerRef.current = commentManager;
    let cancelled = false;

    const handleContextMenu = (event: MouseEvent) => {
      const selectedText = getSelectionTextWithin(container);
      if (!selectedText || !commentManagerRef.current) {
        return;
      }
      event.preventDefault();
      commentManagerRef.current.handleAddCommentRequest(selectedText);
    };

    container.addEventListener("contextmenu", handleContextMenu);

    void (async () => {
      const preferences = await readMdreviewPreferences(adapters.storage);
      if (preferences.commentsEnabled === false) {
        container.setAttribute("data-mdreview-comments-ready", "false");
        return;
      }
      await commentManager.initialize(renderedSnapshot.source, filePath, preferences);
      if (!cancelled) {
        container.setAttribute("data-mdreview-comments-ready", "true");
      }
    })().catch(() => {
      if (!cancelled) {
        container.setAttribute("data-mdreview-comments-ready", "false");
      }
    });

    return () => {
      cancelled = true;
      container.removeEventListener("contextmenu", handleContextMenu);
      if (commentManagerRef.current === commentManager) {
        commentManagerRef.current = null;
      }
      commentManager.destroy();
    };
  }, [adapters.file, adapters.storage, filePath, renderedSnapshot]);

  useEffect(() => {
    if (!renderedSnapshot) {
      return;
    }

    const host = hostRef.current;
    const container = host ? findRenderedContainer(host, filePath) : null;
    if (!container || container.querySelector(".mermaid-container") === null) {
      return;
    }

    let cancelled = false;

    for (const block of container.querySelectorAll(".mermaid-container")) {
      block.classList.add("mermaid-pending");
    }

    void mermaidRenderer.renderAllImmediate(container).catch(() => {
      if (!cancelled) {
        for (const block of container.querySelectorAll(".mermaid-container")) {
          block.classList.remove("mermaid-pending");
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, renderedSnapshot]);

  useEffect(() => {
    if (!renderedSnapshot) {
      return;
    }

    const host = hostRef.current;
    const documentRoot = filePath
      ? host?.querySelector<HTMLElement>(".mdreview-shadow-document")
      : host?.shadowRoot?.querySelector<HTMLElement>(".mdreview-shadow-document");
    if (!documentRoot) return;

    let cancelled = false;
    const themeEngine = new ThemeEngine(adapters.storage);

    void (async () => {
      const themeObject = await themeEngine.loadTheme(renderedSnapshot.themeName);
      const overrides = await themeEngine.getStorageOverrides();
      const cssVariables = themeEngine.compileToCSSVariables(themeObject, overrides);

      if (cancelled) return;

      for (const [key, value] of Object.entries(cssVariables)) {
        documentRoot.style.setProperty(key, value);
      }
      if (overrides.useMaxWidth) {
        documentRoot.style.setProperty("--md-max-width", "100%");
      } else if (overrides.maxWidth !== undefined) {
        documentRoot.style.setProperty("--md-max-width", `${overrides.maxWidth}px`);
      }
      documentRoot.setAttribute("data-theme", themeObject.name);
      documentRoot.setAttribute("data-theme-variant", themeObject.variant);
    })().catch(() => {
      // Theme loading falls back to stylesheet defaults; rendering should not fail.
    });

    return () => {
      cancelled = true;
    };
  }, [adapters.storage, filePath, preferencesRevision, renderedSnapshot]);

  return (
    <div
      ref={hostRef}
      className="mdreview-host-root"
      data-theme={themeName}
      data-mdreview-embedded="shadow"
      style={{ width: "100%" }}
    />
  );
}
