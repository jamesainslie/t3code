// apps/web/src/theme/integration.test.ts
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { ThemeStore } from "./store";
import { buildTerminalTheme } from "./terminal-mapper";
import { buildCssPropertyMap, buildTypographyCssMap } from "./applicator";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
import { DEFAULT_TYPOGRAPHY_TOKENS } from "@t3tools/contracts";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("Theme Engine Integration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("full lifecycle: create -> customize -> export -> import", () => {
    const store = new ThemeStore();
    store.createTheme("My Dark", "dark");
    expect(store.getSnapshot().isCustom).toBe(true);

    // Set 3 tokens
    store.setColorToken("background", "#1a1a2e");
    store.setColorToken("primary", "#e94560");
    store.setColorToken("terminalRed", "#ff6b6b");

    // Verify resolution: custom values used, non-overridden uses defaults
    const resolved = store.getSnapshot().resolved;
    expect(resolved.colors.background).toBe("#1a1a2e");
    expect(resolved.colors.primary).toBe("#e94560");
    expect(resolved.colors.terminalRed).toBe("#ff6b6b");
    expect(resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);

    // Export and verify sparse overrides
    const json = store.exportTheme();
    const parsed = JSON.parse(json);
    expect(parsed.overrides.colors.background).toBe("#1a1a2e");
    expect(parsed.overrides.colors.foreground).toBeUndefined();

    // Import into a fresh store
    const store2 = new ThemeStore();
    store2.importTheme(json);
    const imported = store2.getSnapshot();
    expect(imported.resolved.colors.background).toBe("#1a1a2e");
    expect(imported.resolved.colors.primary).toBe("#e94560");
    expect(imported.resolved.colors.terminalRed).toBe("#ff6b6b");
    expect(imported.resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
  });

  it("terminal mapper end-to-end with custom overrides", () => {
    const store = new ThemeStore();
    store.createTheme("Terminal Test", "dark");
    store.setColorToken("terminalRed", "#ff0000");
    store.setColorToken("terminalGreen", "#00ff00");

    const resolved = store.getSnapshot().resolved;
    const termTheme = buildTerminalTheme(resolved.colors);

    expect(termTheme.red).toBe("#ff0000");
    expect(termTheme.green).toBe("#00ff00");
    expect(termTheme.blue).toBe(DARK_DEFAULTS.terminalBlue);
  });

  it("CSS property map end-to-end with light theme", () => {
    const store = new ThemeStore();
    store.createTheme("Light CSS", "light");
    store.setColorToken("background", "#fafafa");

    const resolved = store.getSnapshot().resolved;
    const cssMap = buildCssPropertyMap(resolved.colors);

    expect(cssMap["--background"]).toBe("#fafafa");
    expect(cssMap["--foreground"]).toBe(LIGHT_DEFAULTS.foreground);
  });

  it("per-theme isolation: switching themes restores correct colors", () => {
    const store = new ThemeStore();

    // Create Theme A (dark) and set background
    store.createTheme("Theme A", "dark");
    store.setColorToken("background", "#111111");
    const idA = store.getSnapshot().theme.id;

    // Flush the debounced persist so Theme A's overrides are saved
    vi.advanceTimersByTime(300);

    // Create Theme B (light) and set background
    store.createTheme("Theme B", "light");
    store.setColorToken("background", "#eeeeee");
    expect(store.getSnapshot().resolved.colors.background).toBe("#eeeeee");

    // Flush persist for Theme B as well
    vi.advanceTimersByTime(300);

    // Switch back to Theme A — its background should be restored
    store.selectTheme(idA);
    expect(store.getSnapshot().resolved.colors.background).toBe("#111111");
  });

  describe("Typography integration", () => {
    it("typography lifecycle: create -> customize -> export -> import", () => {
      const store = new ThemeStore();
      store.createTheme("Typo Test", "dark");

      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      store.setTypographyToken("codeFontSize", "15px");

      // Export and re-import into a fresh store
      const json = store.exportTheme();
      const store2 = new ThemeStore();
      store2.importTheme(json);

      const resolved = store2.getSnapshot().resolved;
      expect(resolved.typography.uiFontFamily).toBe("Inter, sans-serif");
      expect(resolved.typography.codeFontSize).toBe("15px");
      // Non-overridden tokens fall back to defaults
      expect(resolved.typography.lineHeight).toBe(DEFAULT_TYPOGRAPHY_TOKENS.lineHeight);
    });

    it("typography CSS map end-to-end", () => {
      const store = new ThemeStore();
      store.createTheme("CSS Typo", "dark");

      store.setTypographyToken("codeFontFamily", "JetBrains Mono, monospace");

      const resolved = store.getSnapshot().resolved;
      const cssMap = buildTypographyCssMap(resolved.typography);

      expect(cssMap["--code-font-family"]).toBe("JetBrains Mono, monospace");
      expect(cssMap["--ui-font-family"]).toBe(DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily);
    });

    it("typography isolation across themes", () => {
      const store = new ThemeStore();

      // Create Theme A and set uiFontSize
      store.createTheme("Theme A", "dark");
      store.setTypographyToken("uiFontSize", "18px");
      const idA = store.getSnapshot().theme.id;

      // Flush debounced persist so Theme A's overrides are saved
      vi.advanceTimersByTime(300);

      // Create Theme B with a different uiFontSize
      store.createTheme("Theme B", "dark");
      store.setTypographyToken("uiFontSize", "12px");

      // Switch back to Theme A — its font size should be restored
      store.selectTheme(idA);
      expect(store.getSnapshot().resolved.typography.uiFontSize).toBe("18px");
    });

    it("mixed color + typography: export contains both, sparse overrides only", () => {
      const store = new ThemeStore();
      store.createTheme("Mixed", "dark");

      store.setColorToken("background", "#1a1a2e");
      store.setTypographyToken("codeFontFamily", "Fira Code");

      const json = store.exportTheme();
      const parsed = JSON.parse(json);

      // Both override sections present
      expect(parsed.overrides.colors.background).toBe("#1a1a2e");
      expect(parsed.overrides.typography.codeFontFamily).toBe("Fira Code");

      // Sparse: non-overridden typography tokens are absent
      expect(parsed.overrides.typography.uiFontFamily).toBeUndefined();
    });
  });
});
