import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const testEnvironmentId = EnvironmentId.make("environment-1");

const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: testEnvironmentId,
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: null,
};

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it("stores browser secrets inline with the saved environment record", async () => {
    const testWindow = getTestWindow();
    const {
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      readBrowserSavedEnvironmentRegistry,
      readBrowserSavedEnvironmentSecret,
      writeBrowserSavedEnvironmentRegistry,
      writeBrowserSavedEnvironmentSecret,
    } = await import("./clientPersistenceStorage");

    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);
    expect(writeBrowserSavedEnvironmentSecret(testEnvironmentId, "bearer-token")).toBe(true);
    writeBrowserSavedEnvironmentRegistry([savedRegistryRecord]);

    expect(readBrowserSavedEnvironmentRegistry()).toEqual([savedRegistryRecord]);
    expect(readBrowserSavedEnvironmentSecret(testEnvironmentId)).toBe("bearer-token");
    expect(
      JSON.parse(testWindow.localStorage.getItem(SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY)!),
    ).toEqual({
      version: 1,
      records: [
        {
          ...savedRegistryRecord,
          bearerToken: "bearer-token",
        },
      ],
    });
  });

  describe("theme preferences (browser fallback)", () => {
    it("returns null when no theme keys are set in localStorage", async () => {
      getTestWindow();
      const { readBrowserThemePreferences } = await import("./clientPersistenceStorage");

      expect(readBrowserThemePreferences()).toBeNull();
    });

    it("returns null when stored preference is not a recognized value", async () => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("t3code:theme", "rainbow");

      const { readBrowserThemePreferences } = await import("./clientPersistenceStorage");

      expect(readBrowserThemePreferences()).toBeNull();
    });

    it("round-trips a theme preference document through browser localStorage", async () => {
      const testWindow = getTestWindow();
      const { readBrowserThemePreferences, writeBrowserThemePreferences } =
        await import("./clientPersistenceStorage");

      writeBrowserThemePreferences({
        preference: "dark",
        activeThemeId: "monokai",
        savedThemes: [{ id: "monokai", name: "Monokai" }],
      });

      expect(readBrowserThemePreferences()).toEqual({
        preference: "dark",
        activeThemeId: "monokai",
        savedThemes: [{ id: "monokai", name: "Monokai" }],
      });
      expect(testWindow.localStorage.getItem("t3code:theme")).toBe("dark");
      expect(testWindow.localStorage.getItem("t3code:active-theme-id:v1")).toBe("monokai");
      expect(testWindow.localStorage.getItem("t3code:custom-themes:v1")).toBe(
        JSON.stringify([{ id: "monokai", name: "Monokai" }]),
      );
    });

    it("clears the active theme key when activeThemeId is null", async () => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("t3code:active-theme-id:v1", "stale");
      const { writeBrowserThemePreferences } = await import("./clientPersistenceStorage");

      writeBrowserThemePreferences({
        preference: "system",
        activeThemeId: null,
        savedThemes: [],
      });

      expect(testWindow.localStorage.getItem("t3code:active-theme-id:v1")).toBeNull();
    });
  });

  describe("markdown preferences (browser fallback)", () => {
    it("returns null when no markdown preferences are stored", async () => {
      getTestWindow();
      const { readBrowserMarkdownPreferences } = await import("./clientPersistenceStorage");

      expect(readBrowserMarkdownPreferences()).toBeNull();
    });

    it("round-trips an arbitrary markdown preferences document under the canonical T3StorageAdapter key", async () => {
      const testWindow = getTestWindow();
      const {
        MARKDOWN_PREFERENCES_STORAGE_KEY,
        readBrowserMarkdownPreferences,
        writeBrowserMarkdownPreferences,
      } = await import("./clientPersistenceStorage");

      writeBrowserMarkdownPreferences({
        theme: "github-dark",
        lineNumbers: true,
        tocPosition: "right",
      });

      expect(readBrowserMarkdownPreferences()).toEqual({
        theme: "github-dark",
        lineNumbers: true,
        tocPosition: "right",
      });
      // Renderer-side consumers (MdreviewRenderer, MarkdownSettings via
      // T3StorageAdapter) read from `t3code:mdreview:preferences`. The
      // browser fallback MUST write to that exact key or the two halves of
      // the system will silently diverge — the failure mode is "settings
      // vanish on reload" and is hard to spot without an integration test.
      expect(MARKDOWN_PREFERENCES_STORAGE_KEY).toBe("t3code:mdreview:preferences");
      expect(testWindow.localStorage.getItem("t3code:mdreview:preferences")).toBe(
        JSON.stringify({
          theme: "github-dark",
          lineNumbers: true,
          tocPosition: "right",
        }),
      );
      expect(testWindow.localStorage.getItem("t3code:mdreview:")).toBeNull();
    });

    it("returns null when stored markdown preferences are corrupt JSON", async () => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("t3code:mdreview:preferences", "{not-json");
      const { readBrowserMarkdownPreferences } = await import("./clientPersistenceStorage");

      expect(readBrowserMarkdownPreferences()).toBeNull();
    });
  });
});
