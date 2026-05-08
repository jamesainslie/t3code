// @vitest-environment browser
//
// Browser-mode persistence test for the ThemeStore. Run via
// `bun run test:browser` (uses Vitest's browser provider with Playwright +
// Chromium under the hood per `vitest.browser.config.ts`).
//
// Theme persistence has two layers:
//   1. localStorage (always-on, populated synchronously by the store).
//   2. Desktop bridge (electron-only; `bridge.{get,set}ThemePreferences`).
//
// On reload the store re-reads localStorage during construction, then async
// `hydrateFromDesktop()` overrides with the desktop value if available. These
// tests pin the contract for both halves so a regression that breaks one half
// (e.g. silently dropping `setThemePreferences` calls, or hydrating from a
// stale localStorage doc instead of the bridge) is caught immediately.

import "../index.css";

import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeStore } from "./store";

type DesktopBridgeOverrides = Partial<DesktopBridge>;

function createDesktopBridge(overrides: DesktopBridgeOverrides = {}): DesktopBridge {
  return {
    getAppBranding: () => null,
    getLocalEnvironmentBootstrap: () => null,
    getClientSettings: vi.fn().mockResolvedValue(null),
    setClientSettings: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentRegistry: vi.fn().mockResolvedValue([]),
    setSavedEnvironmentRegistry: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentSecret: vi.fn().mockResolvedValue(null),
    setSavedEnvironmentSecret: vi.fn().mockResolvedValue(true),
    removeSavedEnvironmentSecret: vi.fn().mockResolvedValue(undefined),
    getSavedProjectRegistry: vi.fn().mockResolvedValue([]),
    setSavedProjectRegistry: vi.fn().mockResolvedValue(undefined),
    getThemePreferences: vi.fn().mockResolvedValue(null),
    setThemePreferences: vi.fn().mockResolvedValue(undefined),
    getMarkdownPreferences: vi.fn().mockResolvedValue(null),
    setMarkdownPreferences: vi.fn().mockResolvedValue(undefined),
    getServerExposureState: vi.fn().mockResolvedValue({
      mode: "local-only" as const,
      endpointUrl: null,
      advertisedHost: null,
    }),
    setServerExposureMode: vi.fn().mockResolvedValue({
      mode: "local-only" as const,
      endpointUrl: null,
      advertisedHost: null,
    }),
    pickFolder: vi.fn().mockResolvedValue(null),
    confirm: vi.fn().mockResolvedValue(true),
    setTheme: vi.fn().mockResolvedValue(undefined),
    setWindowOpacity: vi.fn().mockResolvedValue(undefined),
    setVibrancy: vi.fn().mockResolvedValue(undefined),
    getPlatform: vi.fn().mockResolvedValue("darwin"),
    showContextMenu: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    onMenuAction: () => () => {},
    getUpdateState: vi.fn().mockResolvedValue({
      enabled: false,
      status: "idle" as const,
      channel: "latest" as const,
      currentVersion: "0.0.0-test",
      hostArch: "arm64" as const,
      appArch: "arm64" as const,
      runningUnderArm64Translation: false,
      availableVersion: null,
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: null,
      message: null,
      errorContext: null,
      canRetry: false,
    }),
    setUpdateChannel: vi.fn(),
    checkForUpdate: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    onUpdateState: () => () => {},
    sshConnect: vi.fn(),
    sshDisconnect: vi.fn(),
    sshStatus: vi.fn().mockResolvedValue({ connections: [] }),
    onSshStatusUpdate: () => undefined,
    recordRemoteHost: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("ThemeStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "desktopBridge");
    localStorage.clear();
  });

  it("persists user preference changes to localStorage and the desktop bridge", async () => {
    const setThemePreferences = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = createDesktopBridge({ setThemePreferences });

    const store = new ThemeStore();
    store.setPreference("dark");

    expect(store.getSnapshot().preference).toBe("dark");
    expect(localStorage.getItem("t3code:theme")).toBe("dark");
    await waitFor(() => setThemePreferences.mock.calls.length > 0, 2_000);
    const lastCall = setThemePreferences.mock.calls.at(-1);
    expect(lastCall?.[0]).toMatchObject({
      preference: "dark",
    });
  });

  it("persists newly created custom themes through the desktop bridge", async () => {
    const setThemePreferences = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = createDesktopBridge({ setThemePreferences });

    const store = new ThemeStore();
    store.createTheme("My Theme", "dark");

    const snapshot = store.getSnapshot();
    expect(snapshot.theme.name).toBe("My Theme");
    expect(snapshot.isCustom).toBe(true);

    await waitFor(() => setThemePreferences.mock.calls.length > 0, 2_000);
    const lastCall = setThemePreferences.mock.calls.at(-1);
    const persisted = lastCall?.[0] as {
      preference?: string;
      activeThemeId?: string | null;
      savedThemes?: ReadonlyArray<{ id: string; name: string }>;
    };
    expect(persisted.activeThemeId).toBe(snapshot.theme.id);
    expect(persisted.savedThemes?.some((theme) => theme.name === "My Theme")).toBe(true);
  });

  it("hydrates from a desktop preference document and replaces the localStorage default", async () => {
    const customTheme = {
      id: "custom-1",
      name: "Persisted Theme",
      base: "dark" as const,
      overrides: {
        colors: { primary: "#ff8800" },
      },
      metadata: {
        version: 1,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
    };
    window.desktopBridge = createDesktopBridge({
      getThemePreferences: vi.fn().mockResolvedValue({
        preference: "dark",
        activeThemeId: "custom-1",
        savedThemes: [customTheme],
      }),
    });

    const store = new ThemeStore();
    expect(store.getSnapshot().preference).toBe("system");

    store.hydrateFromDesktop();

    await waitFor(() => store.getSnapshot().theme.id === "custom-1", 2_000);
    const snapshot = store.getSnapshot();
    expect(snapshot.preference).toBe("dark");
    expect(snapshot.theme.name).toBe("Persisted Theme");
    expect(snapshot.isCustom).toBe(true);
    expect(localStorage.getItem("t3code:theme")).toBe("dark");
  });

  it("does not let a late hydrate response overwrite a fresh user preference", async () => {
    // The bridge intentionally never resolves until we manually release it,
    // simulating a slow `getThemePreferences` round-trip (slow disk, IPC
    // contention, hung native handler, etc.).
    type ThemeDocument = {
      preference: "light" | "dark" | "system";
      activeThemeId: string | null;
      savedThemes: ReadonlyArray<unknown>;
    };
    const deferred: { resolve: (value: ThemeDocument | null) => void } = {
      resolve: () => undefined,
    };
    const bridgeReadPromise = new Promise<ThemeDocument | null>((resolve) => {
      deferred.resolve = resolve;
    });

    const setThemePreferences = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = createDesktopBridge({
      getThemePreferences: vi.fn(() => bridgeReadPromise),
      setThemePreferences,
    });

    const store = new ThemeStore();
    store.hydrateFromDesktop();

    // User mutates BEFORE the bridge read settles.
    store.setPreference("dark");
    expect(store.getSnapshot().preference).toBe("dark");

    // Now release the bridge with a stale "light" doc that would otherwise
    // clobber the user's just-set "dark" preference.
    deferred.resolve({
      preference: "light",
      activeThemeId: null,
      savedThemes: [],
    });

    // Give the awaited then() a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.getSnapshot().preference).toBe("dark");
    expect(localStorage.getItem("t3code:theme")).toBe("dark");
  });

  it("survives a simulated reload by replaying the desktop bridge document", async () => {
    let stored: {
      preference: "light" | "dark" | "system";
      activeThemeId: string | null;
      savedThemes: ReadonlyArray<unknown>;
    } | null = null;
    const bridge = createDesktopBridge({
      getThemePreferences: vi.fn(async () => stored),
      setThemePreferences: vi.fn(async (next) => {
        stored = next;
      }),
    });
    window.desktopBridge = bridge;

    const store = new ThemeStore();
    store.setPreference("dark");
    store.createTheme("Reload Theme", "dark");
    const originalId = store.getSnapshot().theme.id;
    await waitFor(() => stored?.activeThemeId === originalId, 2_000);

    // Simulate full reload: wipe in-memory state and localStorage, build a
    // fresh store, then hydrate from the desktop bridge document.
    localStorage.clear();
    window.desktopBridge = bridge;

    const reloaded = new ThemeStore();
    reloaded.hydrateFromDesktop();

    await waitFor(() => reloaded.getSnapshot().theme.id === originalId, 2_000);
    const snapshot = reloaded.getSnapshot();
    expect(snapshot.preference).toBe("dark");
    expect(snapshot.theme.name).toBe("Reload Theme");
    expect(snapshot.isCustom).toBe(true);
  });
});
