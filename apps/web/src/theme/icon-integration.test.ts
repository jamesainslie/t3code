// apps/web/src/theme/icon-integration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeStore } from "./store";
import { IconSetRegistry } from "./icon-registry";

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

describe("Icon Set Integration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("full file icon lifecycle: default -> set -> resolved", () => {
    const store = new ThemeStore();
    expect(store.getFileIconSetId()).toBe("default");

    store.setFileIconSet("material");
    expect(store.getFileIconSetId()).toBe("material");
    expect(store.getSnapshot().resolved.icons.fileIcons.id).toBe("material");
  });

  it("UI icon lifecycle: set -> resolved", () => {
    const store = new ThemeStore();
    store.setUiIconSet("phosphor");
    expect(store.getSnapshot().resolved.icons.uiIcons.id).toBe("phosphor");
  });

  it("export/import roundtrip preserves file icon set", () => {
    const store = new ThemeStore();
    store.createTheme("Icon RT", "dark");
    store.setFileIconSet("material");

    const json = store.exportTheme();
    const store2 = new ThemeStore();
    store2.importTheme(json);

    expect(store2.getSnapshot().resolved.icons.fileIcons.id).toBe("material");
  });

  it("fallback on unknown icon set resolves to default via registry", () => {
    const store = new ThemeStore();
    store.setFileIconSet("nonexistent-set");

    // The engine resolves the raw ID as-is
    expect(store.getSnapshot().resolved.icons.fileIcons.id).toBe("nonexistent-set");

    // But the registry falls back to "default" for unknown sets
    const registry = new IconSetRegistry();
    const resolved = registry.resolve({ fileIcons: "nonexistent-set" });
    expect(resolved.fileIcons.id).toBe("default");
  });

  it("per-theme isolation: icon sets are independent across themes", () => {
    const store = new ThemeStore();

    store.createTheme("Theme A", "dark");
    store.setFileIconSet("material");
    const idA = store.getSnapshot().theme.id;
    vi.advanceTimersByTime(300);

    store.createTheme("Theme B", "dark");
    expect(store.getFileIconSetId()).toBe("default");

    store.selectTheme(idA);
    expect(store.getSnapshot().resolved.icons.fileIcons.id).toBe("material");
  });

  it("registry independence: register, resolve, unregister, fallback", () => {
    const registry = new IconSetRegistry();
    registry.register({ id: "custom", name: "Custom", version: "1.0.0", type: "file-icons" });

    const resolved = registry.resolve({ fileIcons: "custom" });
    expect(resolved.fileIcons.id).toBe("custom");

    registry.unregister("custom", "file-icons");
    const afterUnregister = registry.resolve({ fileIcons: "custom" });
    expect(afterUnregister.fileIcons.id).toBe("default");
  });
});
