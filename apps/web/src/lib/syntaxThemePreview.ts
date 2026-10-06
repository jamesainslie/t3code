import type { SyntaxTheme } from "@t3tools/contracts";

/**
 * Pickers wait this long on a highlighted theme before applying it, so holding
 * an arrow key does not re-highlight every visible diff on each step.
 */
export const SYNTAX_THEME_PREVIEW_DELAY_MS = 120;

let preview: SyntaxTheme | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function setPreview(next: SyntaxTheme | null): void {
  if (next === preview) return;
  preview = next;
  for (const listener of listeners) listener();
}

/**
 * Shows `theme` on every code surface without saving it, as pickers browse.
 * Pass `null` when the picker closes or selects, to return to the saved theme.
 */
export function previewSyntaxTheme(theme: SyntaxTheme | null): void {
  clearTimeout(pending);
  pending = undefined;
  if (theme === null) {
    setPreview(null);
    return;
  }
  pending = setTimeout(() => {
    pending = undefined;
    setPreview(theme);
  }, SYNTAX_THEME_PREVIEW_DELAY_MS);
}

export function getSyntaxThemePreview(): SyntaxTheme | null {
  return preview;
}

export function subscribeSyntaxThemePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
