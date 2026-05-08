// @vitest-environment browser
//
// Browser-mode persistence test for the Markdown settings panel. Run via
// `bun run test:browser` (uses Vitest's browser provider with Playwright +
// Chromium under the hood per `vitest.browser.config.ts`).
//
// These tests exercise the desktop persistence wiring added by the recent
// settings-persistence work: when the user toggles a markdown preference, the
// panel must call `setMarkdownPreferences` on the desktop bridge so the change
// survives a port change / app restart, and on mount it must hydrate the UI
// from `getMarkdownPreferences` if the bridge has a saved document.
//
// The component reads/writes through the `T3StorageAdapter` from
// `@t3tools/mdreview-host`, which namespaces keys under
// `t3code:mdreview:<key>` (e.g. `t3code:mdreview:preferences`). The
// browser-fallback layer in `clientPersistenceStorage.ts` and the inline
// localStorage handoff in `MarkdownSettings.tsx` use the bare prefix
// `t3code:mdreview:` (no per-key suffix). If those two key shapes drift, the
// desktop persistence path silently breaks: the post-write read returns null
// and `setMarkdownPreferences` is never invoked.

import "../../index.css";

import type { DesktopBridge, LocalApi } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { MarkdownSettings } from "./MarkdownSettings";

// Hoisted mock state so the vi.mock factory can reach it. The mock provides a
// minimal LocalApi whose persistence layer delegates straight to whatever
// desktop bridge each test installs on `window.desktopBridge` — this gives us
// the realistic call path (component -> readLocalApi -> persistence ->
// desktop bridge) without standing up the full environment-connection stack.
const localApiMock = vi.hoisted(() => {
  const noop = (..._args: unknown[]) => undefined;
  return {
    bridge: null as DesktopBridge | null,
    setBridge(bridge: DesktopBridge | null) {
      this.bridge = bridge;
    },
    requireBridge(): DesktopBridge {
      if (!this.bridge) {
        throw new Error("Test desktop bridge not installed");
      }
      return this.bridge;
    },
    noop,
  };
});

vi.mock("../../localApi", () => {
  const buildPersistence = (): LocalApi["persistence"] => ({
    getClientSettings: () => Promise.resolve(localApiMock.bridge?.getClientSettings() ?? null),
    setClientSettings: (settings) =>
      Promise.resolve(localApiMock.bridge?.setClientSettings(settings)).then(() => undefined),
    getSavedEnvironmentRegistry: () =>
      Promise.resolve(localApiMock.bridge?.getSavedEnvironmentRegistry() ?? []),
    setSavedEnvironmentRegistry: (records) =>
      Promise.resolve(localApiMock.bridge?.setSavedEnvironmentRegistry(records)).then(
        () => undefined,
      ),
    getSavedEnvironmentSecret: (key) =>
      Promise.resolve(localApiMock.bridge?.getSavedEnvironmentSecret(key) ?? null),
    setSavedEnvironmentSecret: (key, secret) =>
      Promise.resolve(localApiMock.bridge?.setSavedEnvironmentSecret(key, secret) ?? false),
    removeSavedEnvironmentSecret: (key) =>
      Promise.resolve(localApiMock.bridge?.removeSavedEnvironmentSecret(key)).then(() => undefined),
    getSavedProjectRegistry: () =>
      Promise.resolve(localApiMock.bridge?.getSavedProjectRegistry() ?? []),
    setSavedProjectRegistry: (records) =>
      Promise.resolve(localApiMock.bridge?.setSavedProjectRegistry(records)).then(() => undefined),
    getThemePreferences: () => Promise.resolve(localApiMock.bridge?.getThemePreferences() ?? null),
    setThemePreferences: (prefs) =>
      Promise.resolve(localApiMock.bridge?.setThemePreferences(prefs)).then(() => undefined),
    getMarkdownPreferences: () =>
      Promise.resolve(localApiMock.bridge?.getMarkdownPreferences() ?? null),
    setMarkdownPreferences: (prefs) =>
      Promise.resolve(localApiMock.bridge?.setMarkdownPreferences(prefs)).then(() => undefined),
  });

  const stubApi: LocalApi = {
    dialogs: {
      pickFolder: () => Promise.resolve(null),
      confirm: () => Promise.resolve(true),
    },
    shell: {
      openInEditor: () => Promise.resolve(),
      openExternal: () => Promise.resolve(),
    },
    contextMenu: {
      show: () => Promise.resolve(null),
    },
    persistence: buildPersistence(),
    server: {
      getConfig: () => Promise.reject(new Error("server.getConfig not stubbed in this test")),
      refreshProviders: () =>
        Promise.reject(new Error("server.refreshProviders not stubbed in this test")),
      upsertKeybinding: () =>
        Promise.reject(new Error("server.upsertKeybinding not stubbed in this test")),
      getSettings: () => Promise.reject(new Error("server.getSettings not stubbed in this test")),
      updateSettings: () =>
        Promise.reject(new Error("server.updateSettings not stubbed in this test")),
    },
  };

  return {
    readLocalApi: () => stubApi,
    __resetLocalApiForTests: async () => {
      localApiMock.setBridge(null);
    },
  };
});

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
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("MarkdownSettings desktop persistence", () => {
  type MountedRender = Awaited<ReturnType<typeof render>> & {
    cleanup?: () => Promise<void>;
    unmount?: () => Promise<void>;
  };

  let mounted: MountedRender | null = null;

  function installBridge(bridge: DesktopBridge) {
    window.desktopBridge = bridge;
    localApiMock.setBridge(bridge);
  }

  beforeEach(() => {
    localStorage.clear();
    localApiMock.setBridge(null);
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
      mounted = null;
    }
    Reflect.deleteProperty(window, "desktopBridge");
    localApiMock.setBridge(null);
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("hydrates the UI from desktop bridge preferences on mount", async () => {
    const persisted = {
      theme: "github-dark",
      lineNumbers: true,
      enableHtml: false,
      autoTheme: false,
      lightTheme: "github-light",
      darkTheme: "github-dark",
      syntaxTheme: "monokai-pro",
      logLevel: "info",
      autoReload: false,
      syncTabs: false,
      showToc: true,
      tocMaxDepth: 4,
      tocAutoCollapse: false,
      tocPosition: "right",
      commentsEnabled: true,
      commentAuthor: "Persisted Author",
      blockedSites: [],
      showAllFiles: false,
      iconTheme: "material",
    };
    installBridge(
      createDesktopBridge({
        getMarkdownPreferences: vi.fn().mockResolvedValue(persisted),
      }),
    );

    mounted = (await render(<MarkdownSettings />)) as MountedRender;

    await expect.element(page.getByText("Markdown Renderer")).toBeInTheDocument();
    const lineNumbersSwitch = page.getByLabelText("Show markdown code line numbers");
    await waitFor(async () => {
      const element = await lineNumbersSwitch.element();
      return element.getAttribute("aria-checked") === "true";
    });
    const commentAuthor = page.getByLabelText("Markdown comment author");
    await waitFor(async () => {
      const element = (await commentAuthor.element()) as HTMLInputElement;
      return element.value === "Persisted Author";
    });
  });

  it("persists toggled markdown preferences through setMarkdownPreferences", async () => {
    const setMarkdownPreferences = vi.fn().mockResolvedValue(undefined);
    installBridge(
      createDesktopBridge({
        getMarkdownPreferences: vi.fn().mockResolvedValue(null),
        setMarkdownPreferences,
      }),
    );

    mounted = (await render(<MarkdownSettings />)) as MountedRender;

    const lineNumbersSwitch = page.getByLabelText("Show markdown code line numbers");
    await expect.element(lineNumbersSwitch).toBeInTheDocument();

    // Defensive: wait until the panel has finished its initial settle so the
    // click triggers a single deterministic write rather than racing the
    // hydrate-then-render cycle.
    await waitFor(async () => {
      const element = await lineNumbersSwitch.element();
      return element.getAttribute("aria-checked") === "false";
    });

    await lineNumbersSwitch.click();

    // setMarkdownPreferences must be called with a payload that includes
    // `lineNumbers: true`. With the current key-shape mismatch in
    // MarkdownSettings.tsx (reads `t3code:mdreview:` while T3StorageAdapter
    // writes `t3code:mdreview:preferences`) this call is never made and the
    // test fails — surfacing the bug.
    await waitFor(() => setMarkdownPreferences.mock.calls.length > 0, 4_000);

    expect(setMarkdownPreferences).toHaveBeenCalled();
    const lastCall = setMarkdownPreferences.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(
      expect.objectContaining({
        lineNumbers: true,
      }),
    );
  });

  it("preserves a toggled preference across a simulated reload", async () => {
    type MarkdownPreferenceDoc = Record<string, unknown>;
    let persisted: MarkdownPreferenceDoc | null = null;
    const getMarkdownPreferences = vi.fn(async () => persisted);
    const setMarkdownPreferences = vi.fn(async (next: MarkdownPreferenceDoc) => {
      persisted = next;
    });
    const bridge = createDesktopBridge({
      getMarkdownPreferences: getMarkdownPreferences as DesktopBridge["getMarkdownPreferences"],
      setMarkdownPreferences: setMarkdownPreferences as DesktopBridge["setMarkdownPreferences"],
    });
    installBridge(bridge);

    mounted = (await render(<MarkdownSettings />)) as MountedRender;

    const lineNumbersSwitch = page.getByLabelText("Show markdown code line numbers");
    await waitFor(async () => {
      const element = await lineNumbersSwitch.element();
      return element.getAttribute("aria-checked") === "false";
    });

    await lineNumbersSwitch.click();
    await waitFor(() => setMarkdownPreferences.mock.calls.length > 0, 4_000);

    expect(persisted).not.toBeNull();
    expect(persisted).toMatchObject({ lineNumbers: true });

    // Simulate an app restart / port change: tear the panel down, wipe the
    // local cache (the on-disk persistence is what must survive), and re-mount
    // with the same desktop bridge. The toggle should still be on because the
    // bridge replays its saved doc.
    const teardown = mounted.cleanup ?? mounted.unmount;
    await teardown?.call(mounted);
    mounted = null;
    document.body.innerHTML = "";
    localStorage.clear();
    installBridge(bridge);

    mounted = (await render(<MarkdownSettings />)) as MountedRender;

    const reloadedSwitch = page.getByLabelText("Show markdown code line numbers");
    await waitFor(async () => {
      const element = await reloadedSwitch.element();
      return element.getAttribute("aria-checked") === "true";
    }, 4_000);
  });

  it("writes preferences into localStorage so the renderer adapter sees them", async () => {
    installBridge(createDesktopBridge());

    mounted = (await render(<MarkdownSettings />)) as MountedRender;

    const lineNumbersSwitch = page.getByLabelText("Show markdown code line numbers");
    await waitFor(async () => {
      const element = await lineNumbersSwitch.element();
      return element.getAttribute("aria-checked") === "false";
    });

    await lineNumbersSwitch.click();

    // The renderer (and any other in-page consumer of MD Review) reads
    // through the T3StorageAdapter which uses `t3code:mdreview:preferences`.
    // Make sure that's the key that ends up populated, not the bare
    // `t3code:mdreview:` namespace.
    await waitFor(() => {
      const raw = localStorage.getItem("t3code:mdreview:preferences");
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw) as { lineNumbers?: boolean };
        return parsed.lineNumbers === true;
      } catch {
        return false;
      }
    }, 4_000);
  });
});
