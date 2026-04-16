// apps/web/src/theme/index.ts
export { ThemeStore } from "./store";
export type { ThemeStoreSnapshot } from "./store";
export { resolveTheme } from "./engine";
export { applyCssTokens, clearCssTokens, colorTokenToCssProperty, buildCssPropertyMap, applyTypographyCssTokens, clearTypographyCssTokens, typographyTokenToCssProperty, buildTypographyCssMap } from "./applicator";
export { buildTerminalTheme } from "./terminal-mapper";
export type { TerminalTheme } from "./terminal-mapper";
export { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

import { ThemeStore } from "./store";
import { applyCssTokens, applyTypographyCssTokens } from "./applicator";

// Singleton store instance — initialized once on module load
export const themeStore = new ThemeStore();

function applyThemeToDom(): void {
  const { resolved, resolvedTheme } = themeStore.getSnapshot();
  const root = document.documentElement;

  // Toggle dark class for Tailwind dark: variant
  root.classList.toggle("dark", resolvedTheme === "dark");

  // Apply all color tokens as CSS custom properties (requires real style API)
  if (root.style) {
    applyCssTokens(root, resolved.colors);
    applyTypographyCssTokens(root, resolved.typography);
    root.style.backgroundColor = resolved.colors.appChromeBackground;
  }

  // Set background on body if available
  if (document.body?.style) {
    document.body.style.backgroundColor = resolved.colors.appChromeBackground;
  }

  // Update meta theme-color
  const meta = document.querySelector?.('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved.colors.appChromeBackground);
  }

  // Sync to Electron desktop bridge if available
  if (typeof window !== "undefined" && (window as Window & { desktopBridge?: { setTheme?: (t: string) => Promise<void> } }).desktopBridge?.setTheme) {
    const bridge = (window as Window & { desktopBridge?: { setTheme?: (t: string) => Promise<void> } }).desktopBridge;
    bridge?.setTheme?.(resolvedTheme).catch(() => {
      // ignore — not in Electron context
    });
  }
}

// Apply immediately on load (browser only)
if (typeof document !== "undefined") {
  applyThemeToDom();
}

// Re-apply on every store change
themeStore.subscribe(() => {
  if (typeof document !== "undefined") {
    applyThemeToDom();
  }
});
