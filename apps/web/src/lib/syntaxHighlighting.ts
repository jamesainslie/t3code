import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type HighlighterTypes,
  type SupportedLanguages,
} from "@pierre/diffs";

import type { DiffThemeName } from "./diffRendering";

/**
 * Highlights' hand-written WASM lexers tokenize large files 10-40x faster than
 * Shiki and never backtrack like Shiki's JS regex engine. Only one highlighter
 * type can be active per thread, so every creation site must pass this value.
 */
export const PREFERRED_HIGHLIGHTER: HighlighterTypes = "highlights";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

/** Shared highlighter with `language` and `themeName` attached. */
export function getSyntaxHighlighterPromise(
  language: string,
  themeName: DiffThemeName,
): Promise<DiffsHighlighter> {
  const cacheKey = `${themeName}:${language}`;
  const cached = highlighterPromiseCache.get(cacheKey);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [themeName],
    langs: [language as SupportedLanguages],
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
  }).catch((error) => {
    if (language === "text") {
      highlighterPromiseCache.delete(cacheKey);
      throw error;
    }
    return getSyntaxHighlighterPromise("text", themeName);
  });
  highlighterPromiseCache.set(cacheKey, promise);
  return promise;
}
