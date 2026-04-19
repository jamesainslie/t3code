import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullRequestRefInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPullInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
  GitCreateBranchResult,
} from "./git.ts";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem.ts";
import type {
  ProjectFileChangeEvent,
  ProjectFileWatchInput,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectUpdateFrontmatterInput,
  ProjectUpdateFrontmatterResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project.ts";
import type {
  ServerConfig,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingResult,
} from "./server.ts";
import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal.ts";
import type { ServerUpsertKeybindingInput } from "./server.ts";
import type {
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationSubscribeThreadInput,
} from "./orchestration.ts";
import type {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellStreamItem,
  OrchestrationThreadStreamItem,
} from "./fork/orchestration.ts";
import type { EnvironmentId } from "./baseSchemas.ts";
import type { RemoteIdentityKey } from "./remoteIdentity.ts";
import type { PersistedSavedProjectRecord } from "./savedProjectKey.ts";
import { EditorId } from "./editor.ts";
import { ServerSettings, type ClientSettings, type ServerSettingsPatch } from "./settings.ts";

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopPlatform = "darwin" | "win32" | "linux";
export type DesktopUpdateChannel = "latest" | "nightly";
export type DesktopAppStageLabel = "Alpha" | "Dev" | "Nightly";

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel;
  displayName: string;
}

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  channel: DesktopUpdateChannel;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopEnvironmentBootstrap {
  label: string;
  httpBaseUrl: string | null;
  wsBaseUrl: string | null;
  bootstrapToken?: string;
}

export interface SshEnvironmentConfig {
  host: string;
  user: string;
  port: number;
  projectId: string;
  workspaceRoot: string;
}

export interface PersistedSavedEnvironmentRecord {
  environmentId: EnvironmentId;
  label: string;
  wsBaseUrl: string;
  httpBaseUrl: string;
  createdAt: string;
  lastConnectedAt: string | null;
  sshConfig?: SshEnvironmentConfig | undefined;
}

export interface SavedRemoteEnvironment {
  identityKey: RemoteIdentityKey;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  label: string;
  createdAt: string;
  environmentId: EnvironmentId | null;
  wsBaseUrl: string | null;
  httpBaseUrl: string | null;
  lastConnectedAt: string | null;
  projectId: string;
}

export type DesktopServerExposureMode = "local-only" | "network-accessible";

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  endpointUrl: string | null;
  advertisedHost: string | null;
}

export interface DesktopSshConnectOptions {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
}

export interface DesktopSshStatusUpdate {
  projectId: string;
  phase: string;
}

export type SshProvisioningEventType = "phase-start" | "phase-complete" | "log" | "error";

export interface DesktopSshProvisioningEvent {
  projectId: string;
  type: SshProvisioningEventType;
  /** Phase number (1-5) */
  phase?: number;
  /** Human-readable label for the phase */
  label?: string;
  /** Detail message (log line, error message) */
  message?: string;
  timestamp: number;
}

export interface SavedSshHost {
  id: string;
  label: string;
  host: string;
  user: string;
  port: number;
}

export interface PickFolderOptions {
  initialPath?: string | null;
}

export interface DesktopBridge {
  getAppBranding: () => DesktopAppBranding | null;
  getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap | null;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
  setSavedEnvironmentRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Promise<void>;
  getSavedEnvironmentSecret: (key: EnvironmentId | RemoteIdentityKey) => Promise<string | null>;
  setSavedEnvironmentSecret: (
    key: EnvironmentId | RemoteIdentityKey,
    secret: string,
  ) => Promise<boolean>;
  removeSavedEnvironmentSecret: (key: EnvironmentId | RemoteIdentityKey) => Promise<void>;
  getSavedProjectRegistry: () => Promise<readonly PersistedSavedProjectRecord[]>;
  setSavedProjectRegistry: (records: readonly PersistedSavedProjectRecord[]) => Promise<void>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  setWindowOpacity: (opacity: number) => Promise<void>;
  setVibrancy: (vibrancy: "under-window" | null) => Promise<void>;
  getPlatform: () => Promise<DesktopPlatform>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  sshConnect: (opts: DesktopSshConnectOptions) => Promise<{
    wsUrl: string;
    httpBaseUrl: string;
    pairingUrl: string | undefined;
  }>;
  sshDisconnect: (projectId: string) => Promise<{ ok: boolean }>;
  sshStatus: () => Promise<{ connections: Array<{ projectId: string; wsUrl: string }> }>;
  onSshStatusUpdate: (listener: (update: DesktopSshStatusUpdate) => void) => void;
  onSshProvisionEvent: (listener: (event: DesktopSshProvisioningEvent) => void) => () => void;
  recordRemoteHost: (opts: { host: string; user: string; port: number }) => Promise<void>;
  getSavedSshHosts: () => Promise<SavedSshHost[]>;
  saveSshHost: (host: SavedSshHost) => Promise<void>;
  removeSavedSshHost: (id: string) => Promise<void>;
  sshProbe: (opts: { host: string; user: string; port: number }) => Promise<{ reachable: boolean }>;
  sshKillRemoteSession: (opts: {
    host: string;
    user: string;
    port: number;
    projectId: string;
  }) => Promise<void>;
}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * These capabilities describe the desktop/browser host that the user is
 * currently running: dialogs, editor/external-link opening, context menus, and
 * app-level settings/config access. They must not be used as a proxy for
 * "whatever environment the user is targeting", because in a multi-environment
 * world the local shell and a selected backend environment are distinct
 * concepts.
 */
export interface LocalApi {
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
    getSavedEnvironmentRegistry: () => Promise<readonly PersistedSavedEnvironmentRecord[]>;
    setSavedEnvironmentRegistry: (
      records: readonly PersistedSavedEnvironmentRecord[],
    ) => Promise<void>;
    getSavedEnvironmentSecret: (key: EnvironmentId | RemoteIdentityKey) => Promise<string | null>;
    setSavedEnvironmentSecret: (
      key: EnvironmentId | RemoteIdentityKey,
      secret: string,
    ) => Promise<boolean>;
    removeSavedEnvironmentSecret: (key: EnvironmentId | RemoteIdentityKey) => Promise<void>;
    getSavedProjectRegistry: () => Promise<readonly PersistedSavedProjectRecord[]>;
    setSavedProjectRegistry: (records: readonly PersistedSavedProjectRecord[]) => Promise<void>;
  };
  server: {
    getConfig: () => Promise<ServerConfig>;
    refreshProviders: () => Promise<ServerProviderUpdatedPayload>;
    upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
    getSettings: () => Promise<ServerSettings>;
    updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
  };
}

/**
 * APIs bound to a specific backend environment connection.
 *
 * These operations must always be routed with explicit environment context.
 * They represent remote stateful capabilities such as orchestration, terminal,
 * project, and git operations. In multi-environment mode, each environment gets
 * its own instance of this surface, and callers should resolve it by
 * `environmentId` rather than reaching through the local desktop bridge.
 */
export interface EnvironmentApi {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
  projectFiles: {
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    updateFrontmatter: (
      input: ProjectUpdateFrontmatterInput,
    ) => Promise<ProjectUpdateFrontmatterResult>;
    onFileChange: (
      input: ProjectFileWatchInput,
      callback: (event: ProjectFileChangeEvent) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  filesystem: {
    browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
  };
  git: {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  orchestration: {
    dispatchCommand: (command: ClientOrchestrationCommand) => Promise<{ sequence: number }>;
    getTurnDiff: (input: OrchestrationGetTurnDiffInput) => Promise<OrchestrationGetTurnDiffResult>;
    getFullThreadDiff: (
      input: OrchestrationGetFullThreadDiffInput,
    ) => Promise<OrchestrationGetFullThreadDiffResult>;
    subscribeShell: (
      callback: (event: OrchestrationShellStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
    subscribeThread: (
      input: OrchestrationSubscribeThreadInput,
      callback: (event: OrchestrationThreadStreamItem) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
}
