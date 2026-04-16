import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  DesktopSshConnectOptions,
  DesktopSshProvisioningEvent,
  DesktopSshStatusUpdate,
  SavedSshHost,
} from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_WINDOW_OPACITY_CHANNEL = "desktop:set-window-opacity";
const SET_VIBRANCY_CHANNEL = "desktop:set-vibrancy";
const GET_PLATFORM_CHANNEL = "desktop:get-platform";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL = "desktop:get-local-environment-bootstrap";
const GET_CLIENT_SETTINGS_CHANNEL = "desktop:get-client-settings";
const SET_CLIENT_SETTINGS_CHANNEL = "desktop:set-client-settings";
const GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:get-saved-environment-registry";
const SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL = "desktop:set-saved-environment-registry";
const GET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:get-saved-environment-secret";
const SET_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:set-saved-environment-secret";
const REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL = "desktop:remove-saved-environment-secret";
const GET_SERVER_EXPOSURE_STATE_CHANNEL = "desktop:get-server-exposure-state";
const SET_SERVER_EXPOSURE_MODE_CHANNEL = "desktop:set-server-exposure-mode";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const SSH_CONNECT_CHANNEL = "desktop:ssh-connect";
const SSH_DISCONNECT_CHANNEL = "desktop:ssh-disconnect";
const SSH_STATUS_CHANNEL = "desktop:ssh-status";
const SSH_STATUS_UPDATE_CHANNEL = "desktop:ssh-status-update";
const SSH_RECORD_HOST_CHANNEL = "desktop:ssh-record-host";
const SSH_PROVISION_EVENT_CHANNEL = "desktop:ssh-provision-event";
const SSH_GET_SAVED_HOSTS_CHANNEL = "desktop:get-saved-ssh-hosts";
const SSH_SAVE_HOST_CHANNEL = "desktop:save-ssh-host";
const SSH_REMOVE_SAVED_HOST_CHANNEL = "desktop:remove-saved-ssh-host";
const SSH_PROBE_CHANNEL = "desktop:ssh-probe";
const SSH_KILL_REMOTE_SESSION_CHANNEL = "desktop:ssh-kill-remote-session";

contextBridge.exposeInMainWorld("desktopBridge", {
  getLocalEnvironmentBootstrap: () => {
    const result = ipcRenderer.sendSync(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstrap"]>;
  },
  getClientSettings: () => ipcRenderer.invoke(GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) => ipcRenderer.invoke(SET_CLIENT_SETTINGS_CHANNEL, settings),
  getSavedEnvironmentRegistry: () => ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL),
  setSavedEnvironmentRegistry: (records) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, records),
  getSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  setSavedEnvironmentSecret: (environmentId, secret) =>
    ipcRenderer.invoke(SET_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId, secret),
  removeSavedEnvironmentSecret: (environmentId) =>
    ipcRenderer.invoke(REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, environmentId),
  getServerExposureState: () => ipcRenderer.invoke(GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) => ipcRenderer.invoke(SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setWindowOpacity: (opacity: number) => ipcRenderer.invoke(SET_WINDOW_OPACITY_CHANNEL, opacity),
  setVibrancy: (vibrancy: "under-window" | null) =>
    ipcRenderer.invoke(SET_VIBRANCY_CHANNEL, vibrancy),
  getPlatform: () => ipcRenderer.invoke(GET_PLATFORM_CHANNEL),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  checkForUpdate: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  sshConnect: (opts: DesktopSshConnectOptions) => ipcRenderer.invoke(SSH_CONNECT_CHANNEL, opts),
  sshDisconnect: (projectId: string) => ipcRenderer.invoke(SSH_DISCONNECT_CHANNEL, { projectId }),
  sshStatus: () => ipcRenderer.invoke(SSH_STATUS_CHANNEL),
  onSshStatusUpdate: (listener: (update: DesktopSshStatusUpdate) => void) => {
    ipcRenderer.on(SSH_STATUS_UPDATE_CHANNEL, (_event, update: unknown) => {
      if (typeof update === "object" && update !== null) {
        listener(update as DesktopSshStatusUpdate);
      }
    });
  },
  onSshProvisionEvent: (listener: (event: DesktopSshProvisioningEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (typeof payload === "object" && payload !== null) {
        listener(payload as DesktopSshProvisioningEvent);
      }
    };
    ipcRenderer.on(SSH_PROVISION_EVENT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(SSH_PROVISION_EVENT_CHANNEL, wrappedListener);
    };
  },
  recordRemoteHost: (opts: { host: string; user: string; port: number }) =>
    ipcRenderer.invoke(SSH_RECORD_HOST_CHANNEL, opts),
  getSavedSshHosts: () => ipcRenderer.invoke(SSH_GET_SAVED_HOSTS_CHANNEL),
  saveSshHost: (host: SavedSshHost) => ipcRenderer.invoke(SSH_SAVE_HOST_CHANNEL, host),
  removeSavedSshHost: (id: string) => ipcRenderer.invoke(SSH_REMOVE_SAVED_HOST_CHANNEL, id),
  sshProbe: (opts: { host: string; user: string; port: number }) =>
    ipcRenderer.invoke(SSH_PROBE_CHANNEL, opts),
  sshKillRemoteSession: (opts: { host: string; user: string; port: number; projectId: string }) =>
    ipcRenderer.invoke(SSH_KILL_REMOTE_SESSION_CHANNEL, opts),
} satisfies DesktopBridge);
