// apps/web/src/hooks/useTheme.ts
import { useSyncExternalStore } from "react";
import { themeStore } from "../theme";
import type { ThemeStoreSnapshot } from "../theme";

type Theme = "light" | "dark" | "system";

interface UseThemeReturn {
  /** The user's preference: "light" | "dark" | "system". */
  theme: Theme;
  /** Set the theme preference. */
  setTheme: (theme: Theme) => void;
  /** The resolved theme after evaluating system preference: always "light" | "dark". */
  resolvedTheme: "light" | "dark";
  /** The full theme store snapshot (for the theme editor). */
  themeSnapshot: ThemeStoreSnapshot;
}

export function useTheme(): UseThemeReturn {
  const snapshot = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  );

  return {
    theme: snapshot.preference,
    setTheme: (t: Theme) => themeStore.setPreference(t),
    resolvedTheme: snapshot.resolvedTheme,
    themeSnapshot: snapshot,
  };
}

/**
 * Sync browser chrome (meta theme-color, background) to current theme.
 * Kept for backwards compatibility — store subscription handles this automatically.
 */
export function syncBrowserChromeTheme(): void {
  const { resolved } = themeStore.getSnapshot();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved.colors.appChromeBackground);
  }
  document.documentElement.style.backgroundColor = resolved.colors.appChromeBackground;
  document.body.style.backgroundColor = resolved.colors.appChromeBackground;
}
