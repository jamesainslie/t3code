// apps/web/src/theme/store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeStore } from "./store";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
import { DEFAULT_TYPOGRAPHY_TOKENS, DEFAULT_TRANSPARENCY_TOKENS } from "@t3tools/contracts";

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

describe("ThemeStore", () => {
  let store: ThemeStore;

  beforeEach(() => {
    localStorageMock.clear();
    store = new ThemeStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with dark default theme when no stored preference", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("dark");
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("initializes with stored base theme preference", () => {
    localStorageMock.setItem("t3code:theme", "light");
    store = new ThemeStore();
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("light");
    expect(snapshot.resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
  });

  it("switches base theme and notifies listeners", () => {
    const listener = vi.fn();
    store.subscribe(listener);

    store.setBase("light");

    expect(listener).toHaveBeenCalled();
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("light");
    expect(snapshot.resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
  });

  it("sets individual color token overrides", () => {
    store.setColorToken("background", "#ff0000");
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe("#ff0000");
    // Other tokens unchanged
    expect(snapshot.resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
  });

  it("resets individual color token to base default", () => {
    store.setColorToken("background", "#ff0000");
    store.resetColorToken("background");
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("tracks which tokens are overridden", () => {
    expect(store.isColorTokenOverridden("background")).toBe(false);
    store.setColorToken("background", "#ff0000");
    expect(store.isColorTokenOverridden("background")).toBe(true);
    store.resetColorToken("background");
    expect(store.isColorTokenOverridden("background")).toBe(false);
  });

  it("creates a new custom theme", () => {
    store.createTheme("My Theme", "dark");
    const snapshot = store.getSnapshot();
    expect(snapshot.theme.name).toBe("My Theme");
    expect(snapshot.theme.base).toBe("dark");
    expect(snapshot.theme.id).toBeDefined();
    expect(snapshot.isCustom).toBe(true);
  });

  it("discards unsaved changes", () => {
    store.createTheme("My Theme", "dark");
    store.setColorToken("background", "#ff0000");
    store.discardChanges();
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("exports theme as JSON string", () => {
    store.createTheme("Export Test", "light");
    store.setColorToken("primary", "#abc123");
    const json = store.exportTheme();
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("Export Test");
    expect(parsed.base).toBe("light");
    expect(parsed.overrides.colors.primary).toBe("#abc123");
  });

  it("imports theme from JSON string", () => {
    const json = JSON.stringify({
      id: "imported-1",
      name: "Imported",
      base: "dark",
      overrides: { colors: { background: "#123456" } },
      metadata: { version: 1, createdAt: "", updatedAt: "" },
    });
    store.importTheme(json);
    const snapshot = store.getSnapshot();
    expect(snapshot.theme.name).toBe("Imported");
    expect(snapshot.resolved.colors.background).toBe("#123456");
    expect(snapshot.isCustom).toBe(true);
  });

  it("lists saved themes", () => {
    store.createTheme("Theme A", "dark");
    store.createTheme("Theme B", "light");
    const list = store.listThemes();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setBase("light");
    expect(listener).not.toHaveBeenCalled();
  });

  it("resolvedTheme returns light or dark for backwards compat", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.resolvedTheme).toBe("dark");
    store.setBase("light");
    expect(store.getSnapshot().resolvedTheme).toBe("light");
  });

  describe("typography token methods", () => {
    it("setTypographyToken uiFontFamily applies correctly and leaves other tokens unchanged", () => {
      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.typography.uiFontFamily).toBe("Inter, sans-serif");
      expect(snapshot.resolved.typography.codeFontFamily).toBe(
        DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily,
      );
      expect(snapshot.resolved.typography.uiFontSize).toBe(DEFAULT_TYPOGRAPHY_TOKENS.uiFontSize);
    });

    it("setTypographyToken codeFontFamily applies correctly", () => {
      store.setTypographyToken("codeFontFamily", "Fira Code, monospace");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.typography.codeFontFamily).toBe("Fira Code, monospace");
    });

    it("setTypographyToken uiFontSize applies correctly", () => {
      store.setTypographyToken("uiFontSize", "16px");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.typography.uiFontSize).toBe("16px");
    });

    it("setTypographyToken lineHeight applies correctly", () => {
      store.setTypographyToken("lineHeight", "1.8");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.typography.lineHeight).toBe("1.8");
    });

    it("resetTypographyToken restores default value", () => {
      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      store.resetTypographyToken("uiFontFamily");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.typography.uiFontFamily).toBe(
        DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily,
      );
    });

    it("isTypographyTokenOverridden tracks override state correctly", () => {
      expect(store.isTypographyTokenOverridden("uiFontFamily")).toBe(false);
      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      expect(store.isTypographyTokenOverridden("uiFontFamily")).toBe(true);
      store.resetTypographyToken("uiFontFamily");
      expect(store.isTypographyTokenOverridden("uiFontFamily")).toBe(false);
    });

    it("setTypographyToken notifies subscribers", () => {
      const listener = vi.fn();
      store.subscribe(listener);
      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      expect(listener).toHaveBeenCalled();
    });

    it("setTypographyToken marks isDirty as true", () => {
      expect(store.getSnapshot().isDirty).toBe(false);
      store.setTypographyToken("uiFontFamily", "Inter, sans-serif");
      expect(store.getSnapshot().isDirty).toBe(true);
    });

    it("exportTheme includes typography override", () => {
      store.createTheme("Typo Test", "dark");
      store.setTypographyToken("codeFontFamily", "Fira Code, monospace");
      const json = store.exportTheme();
      const parsed = JSON.parse(json);
      expect(parsed.overrides.typography.codeFontFamily).toBe("Fira Code, monospace");
    });
  });

  describe("transparency token methods", () => {
    it("setTransparencyToken windowOpacity applies correctly", () => {
      store.setTransparencyToken("windowOpacity", 0.85);
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.windowOpacity).toBe(0.85);
    });

    it("other transparency tokens unchanged after setting windowOpacity", () => {
      store.setTransparencyToken("windowOpacity", 0.85);
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.vibrancy).toBe(DEFAULT_TRANSPARENCY_TOKENS.vibrancy);
    });

    it("setTransparencyToken vibrancy applies correctly", () => {
      store.setTransparencyToken("vibrancy", "auto");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.vibrancy).toBe("auto");
    });

    it("resetTransparencyToken restores default value", () => {
      store.setTransparencyToken("windowOpacity", 0.85);
      store.resetTransparencyToken("windowOpacity");
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.windowOpacity).toBe(
        DEFAULT_TRANSPARENCY_TOKENS.windowOpacity,
      );
    });

    it("isTransparencyTokenOverridden tracks override state correctly", () => {
      expect(store.isTransparencyTokenOverridden("windowOpacity")).toBe(false);
      store.setTransparencyToken("windowOpacity", 0.85);
      expect(store.isTransparencyTokenOverridden("windowOpacity")).toBe(true);
      store.resetTransparencyToken("windowOpacity");
      expect(store.isTransparencyTokenOverridden("windowOpacity")).toBe(false);
    });

    it("clamps windowOpacity below 0.5 to 0.5", () => {
      store.setTransparencyToken("windowOpacity", 0.3);
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.windowOpacity).toBe(0.5);
    });

    it("clamps windowOpacity above 1.0 to 1.0", () => {
      store.setTransparencyToken("windowOpacity", 1.5);
      const snapshot = store.getSnapshot();
      expect(snapshot.resolved.transparency.windowOpacity).toBe(1.0);
    });

    it("setTransparencyToken notifies subscribers", () => {
      const listener = vi.fn();
      store.subscribe(listener);
      store.setTransparencyToken("windowOpacity", 0.9);
      expect(listener).toHaveBeenCalled();
    });
  });
});
