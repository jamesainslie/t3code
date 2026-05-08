// apps/web/src/theme/index.ts
export { ThemeStore } from "./store";
export type { ThemeStoreSnapshot } from "./store";
export { resolveTheme } from "./engine";
export {
  applyCssTokens,
  clearCssTokens,
  colorTokenToCssProperty,
  buildCssPropertyMap,
  applyTypographyCssTokens,
  clearTypographyCssTokens,
  typographyTokenToCssProperty,
  buildTypographyCssMap,
} from "./applicator";
export { buildTerminalTheme } from "./terminal-mapper";
export type { TerminalTheme } from "./terminal-mapper";
export { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
export { IconSetRegistry, BUILTIN_FILE_ICON_SETS, BUILTIN_UI_ICON_SETS } from "./icon-registry";

import { ThemeStore } from "./store";
import { applyCssTokens, applyTypographyCssTokens } from "./applicator";

// Singleton store instance — initialized once on module load
export const themeStore = new ThemeStore();

// Hydrate from desktop persistence (async, won't block initial render).
//
// Only the desktop path is hydrated here on purpose. In a pure browser
// deployment, localStorage IS the source of truth — `ThemeStore`'s
// constructor reads it synchronously via `loadStoredPreference` /
// `loadSavedThemes` / `loadActiveThemeId`, so the equivalent
// `readBrowserThemePreferences` path in `clientPersistenceStorage.ts` would
// be reading the same store the constructor already drained. Adding a
// browser-side hydrate would double-apply or race against the constructor.
//
// `clientPersistenceStorage.readBrowserThemePreferences` exists so other
// surfaces (settings export/import, diagnostics) can read the document
// shape uniformly — it is intentionally not wired up here.
if (
  typeof window !== "undefined" &&
  (window as unknown as { desktopBridge?: unknown }).desktopBridge
) {
  themeStore.hydrateFromDesktop();
}

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
  const bridge = (
    window as Window & {
      desktopBridge?: {
        setTheme?: (t: string) => Promise<void>;
        setWindowOpacity?: (opacity: number) => Promise<void>;
        setVibrancy?: (vibrancy: "under-window" | null) => Promise<void>;
      };
    }
  ).desktopBridge;

  if (typeof window !== "undefined" && bridge?.setTheme) {
    bridge.setTheme(resolvedTheme).catch(() => {
      // ignore — not in Electron context
    });
  }

  // Apply transparency tokens via desktop bridge
  const transparency = resolved.transparency;
  if (bridge?.setWindowOpacity && transparency.windowOpacity !== undefined) {
    bridge.setWindowOpacity(transparency.windowOpacity).catch(() => {});
  }
  if (bridge?.setVibrancy) {
    const vibrancy = transparency.vibrancy === "auto" ? "under-window" : null;
    bridge.setVibrancy(vibrancy).catch(() => {});
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
