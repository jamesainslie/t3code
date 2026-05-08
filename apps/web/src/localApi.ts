import type { ContextMenuItem, LocalApi } from "@t3tools/contracts";

import { resetGitStatusStateForTests } from "./lib/gitStatusState";
import { resetRequestLatencyStateForTests } from "./rpc/requestLatencyState";
import { resetServerStateForTests } from "./rpc/serverState";
import { resetWsConnectionStateForTests } from "./rpc/wsConnectionState";
import { getPrimaryEnvironmentConnection } from "./environments/runtime/service";
import { registerLocalApiResolver } from "./environments/runtime/localApiBridge";

// `localApi` is widely consumed and the runtime barrel re-exports a number of
// stores that themselves need to call back into `ensureLocalApi`. Importing
// the runtime barrel here would form a load-time cycle that Vite's browser
// ESM loader rejects with a TDZ "does not provide an export named ..."
// SyntaxError. We therefore import the specific files we need directly and
// register `ensureLocalApi` with the bridge so the stores can resolve it
// without re-importing this module.
import { type WsRpcClient } from "./rpc/wsRpcClient";
import { showContextMenuFallback } from "./contextMenuFallback";
import {
  readBrowserClientSettings,
  readBrowserSavedEnvironmentRegistry,
  readBrowserSavedEnvironmentSecret,
  readBrowserSavedProjectRegistry,
  removeBrowserSavedEnvironmentSecret,
  writeBrowserClientSettings,
  writeBrowserSavedEnvironmentRegistry,
  writeBrowserSavedEnvironmentSecret,
  writeBrowserSavedProjectRegistry,
  readBrowserThemePreferences,
  writeBrowserThemePreferences,
  readBrowserMarkdownPreferences,
  writeBrowserMarkdownPreferences,
} from "./clientPersistenceStorage";

let cachedApi: LocalApi | undefined;

export function createLocalApi(rpcClient: WsRpcClient): LocalApi {
  return {
    dialogs: {
      pickFolder: async (options) => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder(options);
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    contextMenu: {
      show: async <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        if (window.desktopBridge) {
          return window.desktopBridge.showContextMenu(items, position) as Promise<T | null>;
        }
        return showContextMenuFallback(items, position);
      },
    },
    persistence: {
      getClientSettings: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getClientSettings();
        }
        return readBrowserClientSettings();
      },
      setClientSettings: async (settings) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setClientSettings(settings);
        }
        writeBrowserClientSettings(settings);
      },
      getSavedEnvironmentRegistry: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentRegistry();
        }
        return readBrowserSavedEnvironmentRegistry();
      },
      setSavedEnvironmentRegistry: async (records) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentRegistry(records);
        }
        writeBrowserSavedEnvironmentRegistry(records);
      },
      getSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedEnvironmentSecret(environmentId);
        }
        return readBrowserSavedEnvironmentSecret(environmentId);
      },
      setSavedEnvironmentSecret: async (environmentId, secret) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedEnvironmentSecret(environmentId, secret);
        }
        return writeBrowserSavedEnvironmentSecret(environmentId, secret);
      },
      removeSavedEnvironmentSecret: async (environmentId) => {
        if (window.desktopBridge) {
          return window.desktopBridge.removeSavedEnvironmentSecret(environmentId);
        }
        removeBrowserSavedEnvironmentSecret(environmentId);
      },
      getSavedProjectRegistry: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getSavedProjectRegistry();
        }
        return readBrowserSavedProjectRegistry();
      },
      setSavedProjectRegistry: async (records) => {
        if (window.desktopBridge) {
          return window.desktopBridge.setSavedProjectRegistry(records);
        }
        writeBrowserSavedProjectRegistry(records);
      },
      getThemePreferences: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getThemePreferences();
        }
        return readBrowserThemePreferences();
      },
      setThemePreferences: async (prefs) => {
        if (window.desktopBridge) {
          await window.desktopBridge.setThemePreferences(prefs);
          return;
        }
        writeBrowserThemePreferences(prefs);
      },
      getMarkdownPreferences: async () => {
        if (window.desktopBridge) {
          return window.desktopBridge.getMarkdownPreferences();
        }
        return readBrowserMarkdownPreferences();
      },
      setMarkdownPreferences: async (prefs) => {
        if (window.desktopBridge) {
          await window.desktopBridge.setMarkdownPreferences(prefs);
          return;
        }
        writeBrowserMarkdownPreferences(prefs);
      },
    },
    server: {
      getConfig: rpcClient.server.getConfig,
      refreshProviders: rpcClient.server.refreshProviders,
      upsertKeybinding: rpcClient.server.upsertKeybinding,
      getSettings: rpcClient.server.getSettings,
      updateSettings: rpcClient.server.updateSettings,
    },
  };
}

export function readLocalApi(): LocalApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createLocalApi(getPrimaryEnvironmentConnection().client);
  return cachedApi;
}

export function ensureLocalApi(): LocalApi {
  const api = readLocalApi();
  if (!api) {
    throw new Error("Local API not found");
  }
  return api;
}

// Register the synchronous resolver with the runtime bridge once this module
// has finished evaluating. Stores defined under `environments/runtime` call
// `resolveLocalApi()` from the bridge so they don't need to re-import this
// module (which would reintroduce the load-time cycle).
registerLocalApiResolver(ensureLocalApi);

export async function __resetLocalApiForTests() {
  cachedApi = undefined;
  const { __resetClientSettingsPersistenceForTests } = await import("./hooks/useSettings");
  __resetClientSettingsPersistenceForTests();
  // Resolve the runtime modules directly (not via the barrel) so this
  // test-only entry point doesn't recreate the load-time cycle that
  // `localApi` is otherwise carefully avoiding. The barrel re-exports these
  // symbols, but importing it here would pull every other runtime file in
  // through the same Vite ESM evaluation that's still running.
  const [serviceMod, catalogMod, projectsCatalogMod] = await Promise.all([
    import("./environments/runtime/service"),
    import("./environments/runtime/catalog"),
    import("./environments/runtime/projectsCatalog"),
  ]);
  await serviceMod.resetEnvironmentServiceForTests();
  resetGitStatusStateForTests();
  resetRequestLatencyStateForTests();
  catalogMod.resetSavedEnvironmentRegistryStoreForTests();
  catalogMod.resetSavedEnvironmentRuntimeStoreForTests();
  projectsCatalogMod.resetSavedProjectRegistryStoreForTests();
  resetServerStateForTests();
  resetWsConnectionStateForTests();
}
