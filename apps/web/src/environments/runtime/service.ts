import {
  type AuthSessionRole,
  type EnvironmentId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ProjectId,
  type RemoteIdentityKey,
  type SavedProjectKey,
  type SavedRemoteEnvironment,
  type ServerConfig,
  type SshEnvironmentConfig,
  type TerminalEvent,
  makeRemoteIdentityKey,
  ThreadId,
} from "@t3tools/contracts";
import { type QueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";
import {
  createKnownEnvironment,
  getKnownEnvironmentWsBaseUrl,
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime";

import {
  markPromotedDraftThreadByRef,
  markPromotedDraftThreadsByRef,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { ensureLocalApi } from "~/localApi";
import { collectActiveTerminalThreadIds } from "~/lib/terminalStateCleanup";
import { deriveOrchestrationBatchEffects } from "~/orchestrationEventEffects";
import { projectQueryKeys } from "~/lib/projectReactQuery";
import { providerQueryKeys } from "~/lib/providerReactQuery";
import { getPrimaryKnownEnvironment } from "../primary";
import {
  bootstrapRemoteBearerSession,
  fetchRemoteEnvironmentDescriptor,
  fetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl,
} from "../remote/api";
import { resolveRemotePairingTarget } from "../remote/target";
import {
  getSavedEnvironmentRecord,
  hasSavedEnvironmentRegistryHydrated,
  listSavedEnvironmentRecords,
  persistSavedEnvironmentRecord,
  readSavedEnvironmentBearerToken,
  removeSavedEnvironmentBearerToken,
  type SavedEnvironmentRecord,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
  writeSavedEnvironmentBearerToken,
} from "./catalog";
import { createEnvironmentConnection, type EnvironmentConnection } from "./connection";
import { connectionLog } from "./connectionLog";
import {
  syncSavedProjectsFromReadModel,
  syncSavedProjectsFromWebProjects,
  useSavedProjectRegistryStore,
  waitForSavedProjectRegistryHydration,
} from "./projectsCatalog";
import {
  useStore,
  selectProjectsAcrossEnvironments,
  selectThreadByRef,
  selectThreadsAcrossEnvironments,
} from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { useUiStateStore } from "~/uiStateStore";
import { WsTransport } from "../../rpc/wsTransport";
import { createWsRpcClient, type WsRpcClient } from "../../rpc/wsRpcClient";

type EnvironmentServiceState = {
  readonly queryClient: QueryClient;
  readonly queryInvalidationThrottler: Throttler<() => void>;
  refCount: number;
  stop: () => void;
};

const environmentConnections = new Map<EnvironmentId, EnvironmentConnection>();
const environmentConnectionListeners = new Set<() => void>();

let activeService: EnvironmentServiceState | null = null;
let needsProviderInvalidation = false;

function emitEnvironmentConnectionRegistryChange() {
  for (const listener of environmentConnectionListeners) {
    listener();
  }
}

function getRuntimeErrorFields(error: unknown) {
  return {
    lastError: error instanceof Error ? error.message : String(error),
    lastErrorAt: new Date().toISOString(),
  } as const;
}

function isoNow(): string {
  return new Date().toISOString();
}

function setRuntimeConnecting(environmentId: EnvironmentId) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connecting",
    lastError: null,
    lastErrorAt: null,
  });
}

function setRuntimeConnected(environmentId: EnvironmentId) {
  const connectedAt = isoNow();
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connected",
    authState: "authenticated",
    connectedAt,
    disconnectedAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  const identityKey =
    useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[environmentId];
  if (identityKey) {
    useSavedEnvironmentRegistryStore.getState().markConnected(identityKey, connectedAt);
  }
}

function setRuntimeDisconnected(environmentId: EnvironmentId, reason?: string | null) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "disconnected",
    disconnectedAt: isoNow(),
    ...(reason && reason.trim().length > 0
      ? {
          lastError: reason,
          lastErrorAt: isoNow(),
        }
      : {}),
  });
}

function setRuntimeError(environmentId: EnvironmentId, error: unknown) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "error",
    ...getRuntimeErrorFields(error),
  });
}

function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments: event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }

    coalesced.push(event);
  }

  return coalesced;
}

function reconcileSnapshotDerivedState() {
  const storeState = useStore.getState();
  const threads = selectThreadsAcrossEnvironments(storeState);
  const projects = selectProjectsAcrossEnvironments(storeState);

  useUiStateStore.getState().syncProjects(
    projects.map((project) => ({
      key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      cwd: project.cwd,
    })),
  );
  useUiStateStore.getState().syncThreads(
    threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    })),
  );
  markPromotedDraftThreadsByRef(
    threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
  );

  const activeThreadKeys = collectActiveTerminalThreadIds({
    snapshotThreads: threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      deletedAt: null,
      archivedAt: thread.archivedAt,
    })),
    draftThreadKeys: useComposerDraftStore.getState().listDraftThreadKeys(),
  });
  useTerminalStateStore.getState().removeOrphanedTerminalStates(activeThreadKeys);
}

export function shouldApplyTerminalEvent(input: {
  serverThreadArchivedAt: string | null | undefined;
  hasDraftThread: boolean;
}): boolean {
  if (input.serverThreadArchivedAt !== undefined) {
    return input.serverThreadArchivedAt === null;
  }

  return input.hasDraftThread;
}

function applyRecoveredEventBatch(
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
) {
  if (events.length === 0) {
    return;
  }

  const batchEffects = deriveOrchestrationBatchEffects(events);
  const uiEvents = coalesceOrchestrationUiEvents(events);
  const needsProjectUiSync = events.some(
    (event) =>
      event.type === "project.created" ||
      event.type === "project.meta-updated" ||
      event.type === "project.deleted",
  );

  if (batchEffects.needsProviderInvalidation) {
    needsProviderInvalidation = true;
    void activeService?.queryInvalidationThrottler.maybeExecute();
  }

  useStore.getState().applyOrchestrationEvents(uiEvents, environmentId);
  if (needsProjectUiSync) {
    const projects = selectProjectsAcrossEnvironments(useStore.getState());
    useUiStateStore.getState().syncProjects(
      projects.map((project) => ({
        key: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        cwd: project.cwd,
      })),
    );
    const projectsForEnvironment = projects.filter(
      (project) => project.environmentId === environmentId,
    );
    syncSavedProjectsFromWebProjects(projectsForEnvironment, environmentId);
  }

  const needsThreadUiSync = events.some(
    (event) => event.type === "thread.created" || event.type === "thread.deleted",
  );
  if (needsThreadUiSync) {
    const threads = selectThreadsAcrossEnvironments(useStore.getState());
    useUiStateStore.getState().syncThreads(
      threads.map((thread) => ({
        key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        seedVisitedAt: thread.updatedAt ?? thread.createdAt,
      })),
    );
  }

  const draftStore = useComposerDraftStore.getState();
  for (const threadId of batchEffects.promoteDraftThreadIds) {
    markPromotedDraftThreadByRef(scopeThreadRef(environmentId, threadId));
  }
  for (const threadId of batchEffects.clearDeletedThreadIds) {
    draftStore.clearDraftThread(scopeThreadRef(environmentId, threadId));
    useUiStateStore
      .getState()
      .clearThreadUi(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  }
  for (const threadId of batchEffects.removeTerminalStateThreadIds) {
    useTerminalStateStore.getState().removeTerminalState(scopeThreadRef(environmentId, threadId));
  }
}

function createEnvironmentConnectionHandlers() {
  return {
    applyEventBatch: applyRecoveredEventBatch,
    syncSnapshot: (snapshot: OrchestrationReadModel, environmentId: EnvironmentId) => {
      useStore.getState().syncServerReadModel(snapshot, environmentId);
      reconcileSnapshotDerivedState();
      syncSavedProjectsFromReadModel(snapshot.projects, environmentId);
    },
    applyTerminalEvent: (event: TerminalEvent, environmentId: EnvironmentId) => {
      const threadRef = scopeThreadRef(environmentId, ThreadId.make(event.threadId));
      const serverThread = selectThreadByRef(useStore.getState(), threadRef);
      const hasDraftThread =
        useComposerDraftStore.getState().getDraftThreadByRef(threadRef) !== null;
      if (
        !shouldApplyTerminalEvent({
          serverThreadArchivedAt: serverThread?.archivedAt,
          hasDraftThread,
        })
      ) {
        return;
      }
      useTerminalStateStore.getState().applyTerminalEvent(threadRef, event);
    },
  };
}

function createPrimaryEnvironmentClient(
  knownEnvironment: ReturnType<typeof getPrimaryKnownEnvironment>,
) {
  const wsBaseUrl = getKnownEnvironmentWsBaseUrl(knownEnvironment);
  if (!wsBaseUrl) {
    throw new Error(
      `Unable to resolve websocket URL for ${knownEnvironment?.label ?? "primary environment"}.`,
    );
  }

  return createWsRpcClient(new WsTransport(wsBaseUrl));
}

function createSavedEnvironmentClient(
  record: SavedEnvironmentRecord & { environmentId: EnvironmentId },
  bearerToken: string,
): WsRpcClient {
  useSavedEnvironmentRuntimeStore.getState().ensure(record.environmentId);

  return createWsRpcClient(
    new WsTransport(
      () =>
        resolveRemoteWebSocketConnectionUrl({
          wsBaseUrl: record.wsBaseUrl!,
          httpBaseUrl: record.httpBaseUrl!,
          bearerToken,
        }),
      {
        onAttempt: () => {
          connectionLog({
            level: "info",
            source: "wsTransport",
            label: record.label,
            message: `WS connecting...`,
          });
          setRuntimeConnecting(record.environmentId);
        },
        onOpen: () => {
          connectionLog({
            level: "info",
            source: "wsTransport",
            label: record.label,
            message: `WS connected`,
          });
          setRuntimeConnected(record.environmentId);
        },
        onError: (message: string) => {
          connectionLog({
            level: "error",
            source: "wsTransport",
            label: record.label,
            message: `WS error: ${message}`,
          });
          useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
            connectionState: "error",
            lastError: message,
            lastErrorAt: isoNow(),
          });
        },
        onClose: (details: { readonly code: number; readonly reason: string }) => {
          connectionLog({
            level: "warn",
            source: "wsTransport",
            label: record.label,
            message: `WS closed (code=${details.code}, reason=${details.reason || "none"})`,
          });
          setRuntimeDisconnected(record.environmentId, details.reason);
        },
      },
    ),
  );
}

async function refreshSavedEnvironmentMetadata(
  record: SavedEnvironmentRecord & { environmentId: EnvironmentId },
  bearerToken: string,
  client: WsRpcClient,
  roleHint?: AuthSessionRole | null,
  configHint?: ServerConfig | null,
): Promise<void> {
  const [serverConfig, sessionState] = await Promise.all([
    configHint ? Promise.resolve(configHint) : client.server.getConfig(),
    fetchRemoteSessionState({
      httpBaseUrl: record.httpBaseUrl!,
      bearerToken,
    }),
  ]);

  useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
    authState: sessionState.authenticated ? "authenticated" : "requires-auth",
    descriptor: serverConfig.environment,
    serverConfig,
    role: sessionState.authenticated ? (sessionState.role ?? roleHint ?? null) : null,
  });
}

function registerConnection(connection: EnvironmentConnection): EnvironmentConnection {
  const existing = environmentConnections.get(connection.environmentId);
  if (existing && existing !== connection) {
    throw new Error(`Environment ${connection.environmentId} already has an active connection.`);
  }
  environmentConnections.set(connection.environmentId, connection);
  emitEnvironmentConnectionRegistryChange();
  return connection;
}

async function removeConnection(environmentId: EnvironmentId): Promise<boolean> {
  const connection = environmentConnections.get(environmentId);
  if (!connection) {
    return false;
  }

  environmentConnections.delete(environmentId);
  emitEnvironmentConnectionRegistryChange();
  await connection.dispose();
  return true;
}

function createPrimaryEnvironmentConnection(): EnvironmentConnection {
  const knownEnvironment = getPrimaryKnownEnvironment();
  if (!knownEnvironment?.environmentId) {
    throw new Error("Unable to resolve the primary environment.");
  }

  const existing = environmentConnections.get(knownEnvironment.environmentId);
  if (existing) {
    return existing;
  }

  return registerConnection(
    createEnvironmentConnection({
      kind: "primary",
      knownEnvironment,
      client: createPrimaryEnvironmentClient(knownEnvironment),
      ...createEnvironmentConnectionHandlers(),
    }),
  );
}

async function ensureSavedEnvironmentConnection(
  inputRecord: SavedEnvironmentRecord,
  options?: {
    readonly client?: WsRpcClient;
    readonly bearerToken?: string;
    readonly role?: AuthSessionRole | null;
    readonly serverConfig?: ServerConfig | null;
  },
): Promise<EnvironmentConnection> {
  if (!inputRecord.environmentId) {
    throw new Error("Cannot connect a saved environment without an environmentId.");
  }
  const environmentId: EnvironmentId = inputRecord.environmentId;
  let record = inputRecord as SavedEnvironmentRecord & { environmentId: EnvironmentId };
  connectionLog({
    level: "info",
    source: "ensureConnection",
    label: record.label,
    message: `Ensuring connection for ${record.label} (${environmentId})`,
  });
  const existing = environmentConnections.get(environmentId);
  if (existing) {
    connectionLog({
      level: "info",
      source: "ensureConnection",
      label: record.label,
      message: `Reusing existing connection`,
    });
    return existing;
  }

  // For SSH-tunneled environments, re-provision the tunnel before connecting.
  // The local port may have changed since the last session.
  const hasSshConfig =
    record.user !== "unknown" && typeof window !== "undefined" && window.desktopBridge;
  if (hasSshConfig) {
    const sshConfig = {
      host: record.host,
      user: record.user,
      port: record.port,
      projectId: record.projectId,
      workspaceRoot: record.workspaceRoot,
    };
    try {
      connectionLog({
        level: "info",
        source: "ensureConnection",
        label: record.label,
        message: `SSH: Re-provisioning tunnel for ${record.label}`,
      });
      console.log(`[ssh-reconnect] Re-provisioning tunnel for ${record.label}...`);
      const result = await window.desktopBridge!.sshConnect(sshConfig);
      const newWsBaseUrl = result.wsUrl.replace(/^ws/, "ws");
      const newHttpBaseUrl = result.httpBaseUrl;
      if (newWsBaseUrl !== record.wsBaseUrl || newHttpBaseUrl !== record.httpBaseUrl) {
        connectionLog({
          level: "info",
          source: "ensureConnection",
          label: record.label,
          message: `SSH: Tunnel port changed — ws: ${record.wsBaseUrl} → ${newWsBaseUrl}`,
        });
        console.log(`[ssh-reconnect] Tunnel port changed: ${record.wsBaseUrl} → ${newWsBaseUrl}`);
        // Update the record with the new tunnel port
        record = {
          ...record,
          wsBaseUrl: newWsBaseUrl,
          httpBaseUrl: newHttpBaseUrl,
        };
        await persistSavedEnvironmentRecord(record);
        useSavedEnvironmentRegistryStore.getState().upsert(record);
      }

      // If we got a fresh pairing URL, re-bootstrap the bearer session
      // in case the old token expired
      if (result.pairingUrl) {
        try {
          const resolvedTarget = resolveRemotePairingTarget({ pairingUrl: result.pairingUrl });
          const bearerSession = await bootstrapRemoteBearerSession({
            httpBaseUrl: resolvedTarget.httpBaseUrl,
            credential: resolvedTarget.credential,
          });
          await writeSavedEnvironmentBearerToken(record, bearerSession.sessionToken);
          connectionLog({
            level: "info",
            source: "ensureConnection",
            label: record.label,
            message: `SSH: Bearer token refreshed`,
          });
          console.log(`[ssh-reconnect] Bearer token refreshed for ${record.label}`);
          // Pass the fresh token to the connection
          options = {
            ...options,
            bearerToken: bearerSession.sessionToken,
            role: bearerSession.role,
          };
        } catch (e) {
          console.warn(`[ssh-reconnect] Failed to refresh bearer token, using cached:`, e);
        }
      }

      connectionLog({
        level: "info",
        source: "ensureConnection",
        label: record.label,
        message: `SSH: Tunnel ready`,
      });
      console.log(`[ssh-reconnect] Tunnel ready for ${record.label}`);
    } catch (e) {
      connectionLog({
        level: "error",
        source: "ensureConnection",
        label: record.label,
        message: `SSH: Tunnel failed — ${e instanceof Error ? e.message : String(e)}`,
        detail: e,
      });
      console.error(`[ssh-reconnect] Failed to re-provision tunnel for ${record.label}:`, e);
      useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
        connectionState: "error",
        lastError: `SSH tunnel failed: ${e instanceof Error ? e.message : String(e)}`,
        lastErrorAt: isoNow(),
      });
      // Don't throw — SSH tunnel failure should not crash the app or
      // prevent other environments from connecting. The environment
      // shows as "error" in the UI and can be retried manually.
      return null as unknown as EnvironmentConnection;
    }
  }

  const bearerToken =
    options?.bearerToken ?? (await readSavedEnvironmentBearerToken(record));
  if (!bearerToken) {
    useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
      authState: "requires-auth",
      role: null,
      connectionState: "disconnected",
      lastError: "Saved environment is missing its saved credential. Pair it again.",
      lastErrorAt: isoNow(),
    });
    throw new Error("Saved environment is missing its saved credential.");
  }

  connectionLog({
    level: "info",
    source: "ensureConnection",
    label: record.label,
    message: `WS: Creating client (bearer ${bearerToken ? "present" : "missing"})`,
  });
  const client = options?.client ?? createSavedEnvironmentClient(record, bearerToken);
  const knownEnvironment = createKnownEnvironment({
    id: environmentId,
    label: record.label,
    source: "manual",
    target: {
      httpBaseUrl: record.httpBaseUrl!,
      wsBaseUrl: record.wsBaseUrl!,
    },
  });
  const connection = createEnvironmentConnection({
    kind: "saved",
    knownEnvironment: {
      ...knownEnvironment,
      environmentId,
    },
    client,
    refreshMetadata: async () => {
      await refreshSavedEnvironmentMetadata(record, bearerToken, client);
    },
    onConfigSnapshot: (config) => {
      useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
        descriptor: config.environment,
        serverConfig: config,
      });
    },
    onWelcome: (payload) => {
      useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
        descriptor: payload.environment,
      });
    },
    ...createEnvironmentConnectionHandlers(),
  });

  registerConnection(connection);

  try {
    await refreshSavedEnvironmentMetadata(
      record,
      bearerToken,
      client,
      options?.role ?? null,
      options?.serverConfig ?? null,
    );
    connectionLog({
      level: "info",
      source: "ensureConnection",
      label: record.label,
      message: `Connection fully established`,
    });
    return connection;
  } catch (error) {
    connectionLog({
      level: "error",
      source: "ensureConnection",
      label: record.label,
      message: `Metadata refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      detail: error,
    });
    setRuntimeError(environmentId, error);
    await removeConnection(environmentId).catch(() => false);
    throw error;
  }
}

async function syncSavedEnvironmentConnections(
  records: ReadonlyArray<SavedEnvironmentRecord>,
): Promise<void> {
  connectionLog({
    level: "info",
    source: "sync",
    message: `Syncing ${records.length} saved environment(s)`,
  });
  const connectableRecords = records.filter(
    (record): record is SavedEnvironmentRecord & { environmentId: EnvironmentId } =>
      record.environmentId !== null,
  );
  const expectedEnvironmentIds = new Set(connectableRecords.map((record) => record.environmentId));
  const staleEnvironmentIds = [...environmentConnections.values()]
    .filter((connection) => connection.kind === "saved")
    .map((connection) => connection.environmentId)
    .filter((environmentId) => !expectedEnvironmentIds.has(environmentId));

  await Promise.all(
    staleEnvironmentIds.map((environmentId) => disconnectSavedEnvironment(environmentId)),
  );

  // Partition into SSH remotes (lazy) and non-SSH (connect immediately).
  const isSshRemote = (record: SavedEnvironmentRecord) =>
    record.user !== "unknown" && record.host !== "";
  const sshRecords = connectableRecords.filter(isSshRemote);
  const nonSshRecords = connectableRecords.filter((r) => !isSshRemote(r));

  // SSH remotes: populate registry but start disconnected — connect on demand.
  for (const record of sshRecords) {
    useSavedEnvironmentRuntimeStore.getState().ensure(record.environmentId);
    const current = useSavedEnvironmentRuntimeStore.getState().byId[record.environmentId];
    // Only set disconnected if there is no active connection and no existing runtime state
    if (
      !environmentConnections.has(record.environmentId) &&
      (!current || current.connectionState === "disconnected")
    ) {
      connectionLog({
        level: "info",
        source: "sync",
        label: record.label,
        message: `Lazy skip — SSH remote starts disconnected`,
      });
      setRuntimeDisconnected(record.environmentId);
    }
  }

  // Non-SSH remotes: connect eagerly as before.
  await Promise.all(
    nonSshRecords.map((record) => ensureSavedEnvironmentConnection(record).catch(() => undefined)),
  );
  connectionLog({ level: "info", source: "sync", message: `Sync complete` });
}

function stopActiveService() {
  activeService?.stop();
  activeService = null;
}

export function subscribeEnvironmentConnections(listener: () => void): () => void {
  environmentConnectionListeners.add(listener);
  return () => {
    environmentConnectionListeners.delete(listener);
  };
}

export function listEnvironmentConnections(): ReadonlyArray<EnvironmentConnection> {
  return [...environmentConnections.values()];
}

export function readEnvironmentConnection(
  environmentId: EnvironmentId,
): EnvironmentConnection | null {
  return environmentConnections.get(environmentId) ?? null;
}

export function requireEnvironmentConnection(environmentId: EnvironmentId): EnvironmentConnection {
  const connection = readEnvironmentConnection(environmentId);
  if (!connection) {
    throw new Error(`No websocket client registered for environment ${environmentId}.`);
  }
  return connection;
}

export function getPrimaryEnvironmentConnection(): EnvironmentConnection {
  return createPrimaryEnvironmentConnection();
}

export async function disconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  connectionLog({ level: "info", source: "disconnect", message: `Disconnecting ${environmentId}` });
  const connection = environmentConnections.get(environmentId);
  if (connection?.kind !== "saved") {
    return;
  }

  useSavedEnvironmentRuntimeStore.getState().clear(environmentId);
  await removeConnection(environmentId).catch(() => false);
  connectionLog({ level: "info", source: "disconnect", message: `Disconnected ${environmentId}` });
}

export async function reconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const record = getSavedEnvironmentRecord(environmentId);
  if (!record) {
    throw new Error("Saved environment not found.");
  }

  const connection = environmentConnections.get(environmentId);
  if (!connection) {
    await ensureSavedEnvironmentConnection(record);
    return;
  }

  setRuntimeConnecting(environmentId);
  try {
    await connection.reconnect();
  } catch (error) {
    setRuntimeError(environmentId, error);
    throw error;
  }
}

export async function connectSavedEnvironment(identityKey: RemoteIdentityKey): Promise<void> {
  const record = useSavedEnvironmentRegistryStore.getState().byIdentityKey[identityKey];
  if (!record) {
    throw new Error(`No saved environment found for identity key: ${identityKey}`);
  }
  if (!record.environmentId) {
    throw new Error("Cannot connect a saved environment without an environmentId.");
  }
  const environmentId: EnvironmentId = record.environmentId;

  connectionLog({
    level: "info",
    source: "connectSavedEnvironment",
    identityKey,
    label: record.label,
    message: `Starting connection for ${record.label}`,
  });
  setRuntimeConnecting(environmentId);
  try {
    await ensureSavedEnvironmentConnection(record);
    connectionLog({
      level: "info",
      source: "connectSavedEnvironment",
      identityKey,
      label: record.label,
      message: `Connected successfully`,
    });
  } catch (error) {
    connectionLog({
      level: "error",
      source: "connectSavedEnvironment",
      identityKey,
      label: record.label,
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
      detail: error,
    });
    setRuntimeError(environmentId, error);
    throw error;
  }
}

/**
 * Reconnects the parent environment for a saved project and returns the
 * resolved (environmentId, projectId) pair so the caller can navigate to it.
 *
 * Throws if the saved project or its parent environment are not present in
 * the local registry. If the environment is already connected this short-
 * circuits and immediately returns; otherwise it delegates to
 * {@link connectSavedEnvironment}.
 */
export async function reconnectSavedProject(
  savedProjectKey: SavedProjectKey,
): Promise<{ environmentId: EnvironmentId; projectId: ProjectId }> {
  const savedProject = useSavedProjectRegistryStore.getState().byKey[savedProjectKey];
  if (!savedProject) {
    throw new Error(`Saved project not found: ${savedProjectKey}`);
  }

  const savedEnvironment =
    useSavedEnvironmentRegistryStore.getState().byIdentityKey[savedProject.environmentIdentityKey];
  if (!savedEnvironment) {
    throw new Error(
      `Parent saved environment is missing for project ${savedProject.name}. ` +
        "Re-pair the environment to reconnect this project.",
    );
  }
  if (!savedEnvironment.environmentId) {
    throw new Error(
      `Parent saved environment ${savedEnvironment.label} has no environmentId; cannot reconnect.`,
    );
  }

  // If there's already a live connection, no further work is needed — the
  // caller just navigates to (environmentId, projectId).
  if (!environmentConnections.has(savedEnvironment.environmentId)) {
    await connectSavedEnvironment(savedProject.environmentIdentityKey);
  }

  return {
    environmentId: savedEnvironment.environmentId,
    projectId: savedProject.projectId,
  };
}

export async function removeSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  connectionLog({ level: "info", source: "remove", message: `Removing ${environmentId}` });
  const identityKey =
    useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[environmentId];
  if (identityKey) {
    useSavedEnvironmentRegistryStore.getState().remove(identityKey);
    useSavedProjectRegistryStore.getState().removeByEnvironment(identityKey);
    await removeSavedEnvironmentBearerToken({ identityKey, environmentId });
  } else {
    // No registry entry — best-effort cleanup keyed by environmentId only.
    await ensureLocalApi().persistence.removeSavedEnvironmentSecret(environmentId);
  }
  await disconnectSavedEnvironment(environmentId);
  connectionLog({ level: "info", source: "remove", message: `Removed ${environmentId}` });
}

export async function addOrReconnectSavedEnvironment(input: {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
  readonly sshConfig?: SshEnvironmentConfig;
  readonly label?: string;
  readonly projectId: string;
}): Promise<{ record: SavedRemoteEnvironment; isReconnect: boolean }> {
  connectionLog({
    level: "info",
    source: "addOrReconnect",
    label: input.label ?? null,
    message: `Starting add/reconnect flow`,
  });

  // 1. Resolve pairing target
  const resolvedTarget = resolveRemotePairingTarget({
    ...(input.pairingUrl !== undefined ? { pairingUrl: input.pairingUrl } : {}),
    ...(input.host !== undefined ? { host: input.host } : {}),
    ...(input.pairingCode !== undefined ? { pairingCode: input.pairingCode } : {}),
  });

  // 2. Fetch environment descriptor
  const descriptor = await fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: resolvedTarget.httpBaseUrl,
  });
  const environmentId = descriptor.environmentId;

  // 3. Compute identity key
  const sshFields = input.sshConfig ?? {
    host: new URL(resolvedTarget.httpBaseUrl).hostname,
    user: "unknown",
    port: 22,
    workspaceRoot: "/",
    projectId: input.projectId,
  };
  const identityKey = makeRemoteIdentityKey(sshFields);

  // 4. Check if this identity already exists
  const existingRecord =
    useSavedEnvironmentRegistryStore.getState().byIdentityKey[identityKey] ?? null;
  connectionLog({
    level: "info",
    source: "addOrReconnect",
    identityKey,
    label: input.label ?? null,
    message: existingRecord
      ? `Identity hit — existing record found`
      : `Identity miss — new environment`,
  });

  // 5. If existing and environmentId changed, disconnect old connection
  if (existingRecord?.environmentId && existingRecord.environmentId !== environmentId) {
    await disconnectSavedEnvironment(existingRecord.environmentId).catch(() => {});
  }

  // 6. Bootstrap bearer session
  const bearerSession = await bootstrapRemoteBearerSession({
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    credential: resolvedTarget.credential,
  });

  // 7. Build record (new or updated), reusing createdAt and projectId from existing
  const record: SavedRemoteEnvironment = {
    identityKey,
    host: sshFields.host,
    user: sshFields.user,
    port: sshFields.port,
    workspaceRoot: sshFields.workspaceRoot,
    projectId: existingRecord?.projectId ?? sshFields.projectId ?? input.projectId,
    environmentId,
    label: (input.label ?? "").trim() || descriptor.label,
    wsBaseUrl: resolvedTarget.wsBaseUrl,
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    createdAt: existingRecord?.createdAt ?? isoNow(),
    lastConnectedAt: isoNow(),
  };

  // 8. Persist
  await persistSavedEnvironmentRecord(record);
  const didPersistBearerToken = await writeSavedEnvironmentBearerToken(
    record,
    bearerSession.sessionToken,
  );
  if (!didPersistBearerToken) {
    await ensureLocalApi().persistence.setSavedEnvironmentRegistry(
      listSavedEnvironmentRecords()
        .filter((entry) => entry.environmentId !== null)
        .map((entry) => ({
          environmentId: entry.environmentId!,
          label: entry.label,
          httpBaseUrl: entry.httpBaseUrl ?? "",
          wsBaseUrl: entry.wsBaseUrl ?? "",
          createdAt: entry.createdAt,
          lastConnectedAt: entry.lastConnectedAt,
          sshConfig: {
            host: entry.host,
            user: entry.user,
            port: entry.port,
            projectId: entry.projectId,
            workspaceRoot: entry.workspaceRoot,
          },
        })),
    );
    throw new Error("Unable to persist saved environment credentials.");
  }

  // 9. Connect
  await ensureSavedEnvironmentConnection(record, {
    bearerToken: bearerSession.sessionToken,
    role: bearerSession.role,
  });

  // 10. Update store
  useSavedEnvironmentRegistryStore.getState().upsert(record);

  connectionLog({
    level: "info",
    source: "addOrReconnect",
    identityKey,
    label: record.label,
    message: `Completed (isReconnect=${existingRecord != null})`,
  });
  return { record, isReconnect: existingRecord != null };
}

/**
 * @deprecated Use `addOrReconnectSavedEnvironment` instead.
 */
export async function addSavedEnvironment(input: {
  readonly label: string;
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
  readonly sshConfig?: {
    readonly host: string;
    readonly user: string;
    readonly port: number;
    readonly projectId: string;
    readonly workspaceRoot: string;
  };
}): Promise<SavedEnvironmentRecord> {
  const projectId = input.sshConfig?.projectId ?? crypto.randomUUID();
  const result = await addOrReconnectSavedEnvironment({
    ...input,
    projectId,
  });
  return result.record;
}

export async function ensureEnvironmentConnectionBootstrapped(
  environmentId: EnvironmentId,
): Promise<void> {
  await environmentConnections.get(environmentId)?.ensureBootstrapped();
}

export function startEnvironmentConnectionService(queryClient: QueryClient): () => void {
  if (activeService?.queryClient === queryClient) {
    activeService.refCount += 1;
    return () => {
      if (!activeService || activeService.queryClient !== queryClient) {
        return;
      }
      activeService.refCount -= 1;
      if (activeService.refCount === 0) {
        stopActiveService();
      }
    };
  }

  stopActiveService();
  needsProviderInvalidation = false;
  const queryInvalidationThrottler = new Throttler(
    () => {
      if (!needsProviderInvalidation) {
        return;
      }
      needsProviderInvalidation = false;
      void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
    },
    {
      wait: 100,
      leading: false,
      trailing: true,
    },
  );

  createPrimaryEnvironmentConnection();

  const unsubscribeSavedEnvironments = useSavedEnvironmentRegistryStore.subscribe(() => {
    if (!hasSavedEnvironmentRegistryHydrated()) {
      return;
    }
    void syncSavedEnvironmentConnections(listSavedEnvironmentRecords());
  });

  void waitForSavedEnvironmentRegistryHydration()
    .then(() => syncSavedEnvironmentConnections(listSavedEnvironmentRecords()))
    .catch(() => undefined);

  void waitForSavedProjectRegistryHydration().catch(() => undefined);

  activeService = {
    queryClient,
    queryInvalidationThrottler,
    refCount: 1,
    stop: () => {
      unsubscribeSavedEnvironments();
      queryInvalidationThrottler.cancel();
    },
  };

  return () => {
    if (!activeService || activeService.queryClient !== queryClient) {
      return;
    }
    activeService.refCount -= 1;
    if (activeService.refCount === 0) {
      stopActiveService();
    }
  };
}

export async function resetEnvironmentServiceForTests(): Promise<void> {
  stopActiveService();
  await Promise.all(
    [...environmentConnections.keys()].map((environmentId) => removeConnection(environmentId)),
  );
}
