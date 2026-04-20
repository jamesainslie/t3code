import {
  type AuthSessionRole,
  type EnvironmentId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamEvent,
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
  scopedThreadKey,
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
import { connectionLog } from "./connectionLog";
import { createEnvironmentConnection, type EnvironmentConnection } from "./connection";
import {
  syncSavedProjectsFromReadModel,
  syncSavedProjectsFromWebProjects,
  useSavedProjectRegistryStore,
  waitForSavedProjectRegistryHydration,
} from "./projectsCatalog";
import {
  useStore,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadSummaryByRef,
  selectThreadByRef,
  selectThreadsAcrossEnvironments,
} from "~/store";
import { useTerminalStateStore } from "~/terminalStateStore";
import { useUiStateStore } from "~/uiStateStore";
import { WsTransport } from "../../rpc/wsTransport";
import { createWsRpcClient, type WsRpcClient } from "../../rpc/wsRpcClient";
import { derivePhysicalProjectKey } from "../../logicalProject";

type EnvironmentServiceState = {
  readonly queryClient: QueryClient;
  readonly queryInvalidationThrottler: Throttler<() => void>;
  refCount: number;
  stop: () => void;
};

type ThreadDetailSubscriptionEntry = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  unsubscribe: () => void;
  unsubscribeConnectionListener: (() => void) | null;
  refCount: number;
  lastAccessedAt: number;
  evictionTimeoutId: ReturnType<typeof setTimeout> | null;
};

const environmentConnections = new Map<EnvironmentId, EnvironmentConnection>();
const environmentConnectionListeners = new Set<() => void>();
const threadDetailSubscriptions = new Map<string, ThreadDetailSubscriptionEntry>();

let activeService: EnvironmentServiceState | null = null;
let needsProviderInvalidation = false;

// Thread detail subscription cache policy:
// - Active consumers keep a subscription retained via refCount.
// - Released subscriptions stay warm for a longer idle TTL to avoid churn
//   while moving around the UI.
// - Threads with active work or pending user action are sticky and are never
//   evicted while they remain non-idle.
// - Capacity eviction only targets idle cached subscriptions.
const THREAD_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS = 15 * 60 * 1000;
const MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS = 32;
const NOOP = () => undefined;

function getThreadDetailSubscriptionKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return scopedThreadKey(scopeThreadRef(environmentId, threadId));
}

function clearThreadDetailSubscriptionEviction(
  entry: ThreadDetailSubscriptionEntry,
): ThreadDetailSubscriptionEntry {
  if (entry.evictionTimeoutId !== null) {
    clearTimeout(entry.evictionTimeoutId);
    entry.evictionTimeoutId = null;
  }
  return entry;
}

function isNonIdleThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  const threadRef = scopeThreadRef(entry.environmentId, entry.threadId);
  const state = useStore.getState();
  const sidebarThread = selectSidebarThreadSummaryByRef(state, threadRef);

  // Prefer shell/sidebar state first because it carries the coarse thread
  // readiness flags used throughout the UI (pending approvals/input/plan).
  if (sidebarThread) {
    if (
      sidebarThread.hasPendingApprovals ||
      sidebarThread.hasPendingUserInput ||
      sidebarThread.hasActionableProposedPlan
    ) {
      return true;
    }

    const orchestrationStatus = sidebarThread.session?.orchestrationStatus;
    if (
      orchestrationStatus &&
      orchestrationStatus !== "idle" &&
      orchestrationStatus !== "stopped"
    ) {
      return true;
    }

    if (sidebarThread.latestTurn?.state === "running") {
      return true;
    }
  }

  const thread = selectThreadByRef(state, threadRef);
  if (!thread) {
    return false;
  }

  const orchestrationStatus = thread.session?.orchestrationStatus;
  return (
    Boolean(
      orchestrationStatus && orchestrationStatus !== "idle" && orchestrationStatus !== "stopped",
    ) ||
    thread.latestTurn?.state === "running" ||
    thread.pendingSourceProposedPlan !== undefined
  );
}

function shouldEvictThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  return entry.refCount === 0 && !isNonIdleThreadDetailSubscription(entry);
}

function attachThreadDetailSubscription(entry: ThreadDetailSubscriptionEntry): boolean {
  if (entry.unsubscribeConnectionListener !== null) {
    entry.unsubscribeConnectionListener();
    entry.unsubscribeConnectionListener = null;
  }
  if (entry.unsubscribe !== NOOP) {
    return true;
  }

  const connection = readEnvironmentConnection(entry.environmentId);
  if (!connection) {
    return false;
  }

  entry.unsubscribe = connection.client.orchestration.subscribeThread(
    { threadId: entry.threadId },
    (item) => {
      if (item.kind === "snapshot") {
        useStore.getState().syncServerThreadDetail(item.snapshot.thread, entry.environmentId);
        return;
      }
      applyEnvironmentThreadDetailEvent(item.event, entry.environmentId);
    },
  );
  return true;
}

function watchThreadDetailSubscriptionConnection(entry: ThreadDetailSubscriptionEntry): void {
  if (entry.unsubscribeConnectionListener !== null) {
    return;
  }

  entry.unsubscribeConnectionListener = subscribeEnvironmentConnections(() => {
    if (attachThreadDetailSubscription(entry)) {
      entry.lastAccessedAt = Date.now();
    }
  });
  attachThreadDetailSubscription(entry);
}

function disposeThreadDetailSubscriptionByKey(key: string): boolean {
  const entry = threadDetailSubscriptions.get(key);
  if (!entry) {
    return false;
  }

  clearThreadDetailSubscriptionEviction(entry);
  entry.unsubscribeConnectionListener?.();
  entry.unsubscribeConnectionListener = null;
  threadDetailSubscriptions.delete(key);
  entry.unsubscribe();
  entry.unsubscribe = NOOP;
  return true;
}

function disposeThreadDetailSubscriptionsForEnvironment(environmentId: EnvironmentId): void {
  for (const [key, entry] of threadDetailSubscriptions) {
    if (entry.environmentId === environmentId) {
      disposeThreadDetailSubscriptionByKey(key);
    }
  }
}

function reconcileThreadDetailSubscriptionsForEnvironment(
  environmentId: EnvironmentId,
  threadIds: ReadonlyArray<ThreadId>,
): void {
  const activeThreadIds = new Set(threadIds);
  for (const [key, entry] of threadDetailSubscriptions) {
    if (entry.environmentId === environmentId && !activeThreadIds.has(entry.threadId)) {
      disposeThreadDetailSubscriptionByKey(key);
    }
  }
}

function scheduleThreadDetailSubscriptionEviction(entry: ThreadDetailSubscriptionEntry): void {
  clearThreadDetailSubscriptionEviction(entry);
  if (!shouldEvictThreadDetailSubscription(entry)) {
    return;
  }

  entry.evictionTimeoutId = setTimeout(() => {
    const currentEntry = threadDetailSubscriptions.get(
      getThreadDetailSubscriptionKey(entry.environmentId, entry.threadId),
    );
    if (!currentEntry) {
      return;
    }

    currentEntry.evictionTimeoutId = null;
    if (!shouldEvictThreadDetailSubscription(currentEntry)) {
      return;
    }
    disposeThreadDetailSubscriptionByKey(
      getThreadDetailSubscriptionKey(entry.environmentId, entry.threadId),
    );
  }, THREAD_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS);
}

function evictIdleThreadDetailSubscriptionsToCapacity(): void {
  if (threadDetailSubscriptions.size <= MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS) {
    return;
  }

  const idleEntries = [...threadDetailSubscriptions.entries()]
    .filter(([, entry]) => shouldEvictThreadDetailSubscription(entry))
    .toSorted(([, left], [, right]) => left.lastAccessedAt - right.lastAccessedAt);

  for (const [key] of idleEntries) {
    if (threadDetailSubscriptions.size <= MAX_CACHED_THREAD_DETAIL_SUBSCRIPTIONS) {
      return;
    }
    disposeThreadDetailSubscriptionByKey(key);
  }
}

function reconcileThreadDetailSubscriptionEvictionState(
  entry: ThreadDetailSubscriptionEntry,
): void {
  clearThreadDetailSubscriptionEviction(entry);
  if (!shouldEvictThreadDetailSubscription(entry)) {
    return;
  }

  scheduleThreadDetailSubscriptionEviction(entry);
}

function reconcileThreadDetailSubscriptionEvictionForThread(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): void {
  const entry = threadDetailSubscriptions.get(
    getThreadDetailSubscriptionKey(environmentId, threadId),
  );
  if (!entry) {
    return;
  }

  reconcileThreadDetailSubscriptionEvictionState(entry);
}

function reconcileThreadDetailSubscriptionEvictionForEnvironment(
  environmentId: EnvironmentId,
): void {
  for (const entry of threadDetailSubscriptions.values()) {
    if (entry.environmentId === environmentId) {
      reconcileThreadDetailSubscriptionEvictionState(entry);
    }
  }
  evictIdleThreadDetailSubscriptionsToCapacity();
}

export function retainThreadDetailSubscription(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): () => void {
  const key = getThreadDetailSubscriptionKey(environmentId, threadId);
  const existing = threadDetailSubscriptions.get(key);
  if (existing) {
    clearThreadDetailSubscriptionEviction(existing);
    existing.refCount += 1;
    existing.lastAccessedAt = Date.now();
    if (!attachThreadDetailSubscription(existing)) {
      watchThreadDetailSubscriptionConnection(existing);
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      existing.refCount = Math.max(0, existing.refCount - 1);
      existing.lastAccessedAt = Date.now();
      if (existing.refCount === 0) {
        reconcileThreadDetailSubscriptionEvictionState(existing);
        evictIdleThreadDetailSubscriptionsToCapacity();
      }
    };
  }

  const entry: ThreadDetailSubscriptionEntry = {
    environmentId,
    threadId,
    unsubscribe: NOOP,
    unsubscribeConnectionListener: null,
    refCount: 1,
    lastAccessedAt: Date.now(),
    evictionTimeoutId: null,
  };
  threadDetailSubscriptions.set(key, entry);
  if (!attachThreadDetailSubscription(entry)) {
    watchThreadDetailSubscriptionConnection(entry);
  }
  evictIdleThreadDetailSubscriptionsToCapacity();

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastAccessedAt = Date.now();
    if (entry.refCount === 0) {
      reconcileThreadDetailSubscriptionEvictionState(entry);
      evictIdleThreadDetailSubscriptionsToCapacity();
    }
  };
}

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

function syncProjectUiFromStore() {
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncProjects(
    projects.map((project) => ({
      key: derivePhysicalProjectKey(project),
      cwd: project.cwd,
    })),
  );
}

function syncThreadUiFromStore() {
  const threads = selectThreadsAcrossEnvironments(useStore.getState());
  useUiStateStore.getState().syncThreads(
    threads.map((thread) => ({
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      seedVisitedAt: thread.updatedAt ?? thread.createdAt,
    })),
  );
  markPromotedDraftThreadsByRef(
    threads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
  );
}

function reconcileSnapshotDerivedState() {
  syncProjectUiFromStore();
  syncThreadUiFromStore();

  const threads = selectThreadsAcrossEnvironments(useStore.getState());
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
        key: derivePhysicalProjectKey(project),
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

  reconcileThreadDetailSubscriptionEvictionForEnvironment(environmentId);
}

export function applyEnvironmentThreadDetailEvent(
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
) {
  applyRecoveredEventBatch([event], environmentId);
}

function applyShellEvent(event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) {
  const threadId =
    event.kind === "thread-upserted"
      ? event.thread.id
      : event.kind === "thread-removed"
        ? event.threadId
        : null;
  const threadRef = threadId ? scopeThreadRef(environmentId, threadId) : null;
  const previousThread = threadRef ? selectThreadByRef(useStore.getState(), threadRef) : undefined;

  useStore.getState().applyShellEvent(event, environmentId);

  switch (event.kind) {
    case "project-upserted":
    case "project-removed":
      syncProjectUiFromStore();
      return;
    case "thread-upserted":
      syncThreadUiFromStore();
      if (!previousThread && threadRef) {
        markPromotedDraftThreadByRef(threadRef);
      }
      if (previousThread?.archivedAt === null && event.thread.archivedAt !== null && threadRef) {
        useTerminalStateStore.getState().removeTerminalState(threadRef);
      }
      reconcileThreadDetailSubscriptionEvictionForThread(environmentId, event.thread.id);
      evictIdleThreadDetailSubscriptionsToCapacity();
      return;
    case "thread-removed":
      if (threadRef) {
        disposeThreadDetailSubscriptionByKey(scopedThreadKey(threadRef));
        useComposerDraftStore.getState().clearDraftThread(threadRef);
        useUiStateStore.getState().clearThreadUi(scopedThreadKey(threadRef));
        useTerminalStateStore.getState().removeTerminalState(threadRef);
      }
      syncThreadUiFromStore();
      return;
  }
}

function createEnvironmentConnectionHandlers() {
  return {
    applyShellEvent,
    syncShellSnapshot: (snapshot: OrchestrationShellSnapshot, environmentId: EnvironmentId) => {
      useStore.getState().syncServerShellSnapshot(snapshot, environmentId);
      reconcileThreadDetailSubscriptionsForEnvironment(
        environmentId,
        snapshot.threads.map((thread) => thread.id),
      );
      reconcileThreadDetailSubscriptionEvictionForEnvironment(environmentId);
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
  const logCtx = { identityKey: record.identityKey, label: record.label };

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
          connectionLog("info", "createSavedEnvironmentClient", "WebSocket connecting", logCtx);
          setRuntimeConnecting(record.environmentId);
        },
        onOpen: () => {
          connectionLog("info", "createSavedEnvironmentClient", "WebSocket connected", logCtx);
          setRuntimeConnected(record.environmentId);
        },
        onError: (message: string) => {
          connectionLog("error", "createSavedEnvironmentClient", "WebSocket error", {
            ...logCtx,
            detail: message,
          });
          useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
            connectionState: "error",
            lastError: message,
            lastErrorAt: isoNow(),
          });
        },
        onClose: (details: { readonly code: number; readonly reason: string }) => {
          connectionLog("warn", "createSavedEnvironmentClient", `WebSocket closed (code=${details.code})`, {
            ...logCtx,
            detail: details,
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

  disposeThreadDetailSubscriptionsForEnvironment(environmentId);
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
  const logCtx = { identityKey: record.identityKey, label: record.label };
  const existing = environmentConnections.get(environmentId);
  if (existing) {
    connectionLog("info", "ensureSavedEnvironmentConnection", "Reusing existing connection", logCtx);
    return existing;
  }

  connectionLog("info", "ensureSavedEnvironmentConnection", "Entry — no existing connection", logCtx);

  // For SSH-tunneled environments, re-provision the tunnel before connecting.
  // The local port may have changed since the last session.
  const hasSshConfig = record.user !== "unknown" && typeof window !== "undefined" && window.desktopBridge;
  if (hasSshConfig) {
    connectionLog("info", "ensureSavedEnvironmentConnection", "SSH re-provision attempt", logCtx);
    const sshConfig = {
      host: record.host,
      user: record.user,
      port: record.port,
      projectId: record.projectId,
      workspaceRoot: record.workspaceRoot,
    };
    try {
      console.log(`[ssh-reconnect] Re-provisioning tunnel for ${record.label}...`);
      const result = await window.desktopBridge.sshConnect(record.sshConfig);
      const newWsBaseUrl = result.wsUrl.replace(/^ws/, "ws");
      const newHttpBaseUrl = result.httpBaseUrl;
      if (newWsBaseUrl !== record.wsBaseUrl || newHttpBaseUrl !== record.httpBaseUrl) {
        connectionLog("info", "ensureSavedEnvironmentConnection", "URL update after SSH tunnel re-provision", {
          ...logCtx,
          detail: { oldWsBaseUrl: record.wsBaseUrl, newWsBaseUrl, oldHttpBaseUrl: record.httpBaseUrl, newHttpBaseUrl },
        });
        console.log(
          `[ssh-reconnect] Tunnel port changed: ${record.wsBaseUrl} → ${newWsBaseUrl}`,
        );
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
          connectionLog("info", "ensureSavedEnvironmentConnection", "Bearer token bootstrap from fresh pairing URL", logCtx);
          const resolvedTarget = resolveRemotePairingTarget({ pairingUrl: result.pairingUrl });
          const bearerSession = await bootstrapRemoteBearerSession({
            httpBaseUrl: resolvedTarget.httpBaseUrl,
            credential: resolvedTarget.credential,
          });
          await writeSavedEnvironmentBearerToken(record.environmentId, bearerSession.sessionToken);
          console.log(`[ssh-reconnect] Bearer token refreshed for ${record.label}`);
          // Pass the fresh token to the connection
          options = { ...options, bearerToken: bearerSession.sessionToken, role: bearerSession.role };
        } catch (e) {
          connectionLog("warn", "ensureSavedEnvironmentConnection", "Bearer token refresh failed, using cached", {
            ...logCtx,
            detail: e instanceof Error ? e.message : String(e),
          });
          console.warn(`[ssh-reconnect] Failed to refresh bearer token, using cached:`, e);
        }
      }

      console.log(`[ssh-reconnect] Tunnel ready for ${record.label}`);
    } catch (e) {
      connectionLog("error", "ensureSavedEnvironmentConnection", "SSH tunnel provision failed", {
        ...logCtx,
        detail: e instanceof Error ? e.message : String(e),
      });
      console.error(`[ssh-reconnect] Failed to re-provision tunnel for ${record.label}:`, e);
      useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
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
    options?.bearerToken ?? (await readSavedEnvironmentBearerToken(record.environmentId));
  if (!bearerToken) {
    connectionLog("error", "ensureSavedEnvironmentConnection", "Missing bearer token — requires re-pairing", logCtx);
    useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
      authState: "requires-auth",
      role: null,
      connectionState: "disconnected",
      lastError: "Saved environment is missing its saved credential. Pair it again.",
      lastErrorAt: isoNow(),
    });
    throw new Error("Saved environment is missing its saved credential.");
  }

  connectionLog("info", "ensureSavedEnvironmentConnection", "Creating WS client", logCtx);
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
    connectionLog("info", "ensureSavedEnvironmentConnection", "Connection fully established", logCtx);
    return connection;
  } catch (error) {
    connectionLog("error", "ensureSavedEnvironmentConnection", "Metadata refresh failed after connect", {
      ...logCtx,
      detail: error instanceof Error ? error.message : String(error),
    });
    setRuntimeError(environmentId, error);
    await removeConnection(environmentId).catch(() => false);
    throw error;
  }
}

async function syncSavedEnvironmentConnections(
  records: ReadonlyArray<SavedEnvironmentRecord>,
): Promise<void> {
  connectionLog("info", "syncSavedEnvironmentConnections", `Start — ${records.length} record(s)`);
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

  if (sshRecords.length > 0) {
    connectionLog("info", "syncSavedEnvironmentConnections", `Skipping ${sshRecords.length} SSH remote(s) (lazy connect)`);
  }

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

  connectionLog("info", "syncSavedEnvironmentConnections", `Completed — ${nonSshRecords.length} eager, ${sshRecords.length} lazy`);
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
  const connection = environmentConnections.get(environmentId);
  if (connection?.kind !== "saved") {
    return;
  }

  const record = getSavedEnvironmentRecord(environmentId);
  const logCtx = {
    ...(record?.identityKey ? { identityKey: record.identityKey } : {}),
    ...(record?.label ? { label: record.label } : {}),
  };
  connectionLog("info", "disconnectSavedEnvironment", "Disconnecting", logCtx);
  useSavedEnvironmentRuntimeStore.getState().clear(environmentId);
  await removeConnection(environmentId).catch(() => false);
  connectionLog("info", "disconnectSavedEnvironment", "Disconnected", logCtx);
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
  const logCtx = { identityKey, label: record.label };

  connectionLog("info", "connectSavedEnvironment", "Starting connection", logCtx);
  setRuntimeConnecting(environmentId);
  try {
    await ensureSavedEnvironmentConnection(record);
    connectionLog("info", "connectSavedEnvironment", "Connection established", logCtx);
  } catch (error) {
    connectionLog("error", "connectSavedEnvironment", "Connection failed", {
      ...logCtx,
      detail: error instanceof Error ? error.message : String(error),
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
  const record = getSavedEnvironmentRecord(environmentId);
  const logCtx = {
    ...(identityKey ? { identityKey } : {}),
    ...(record?.label ? { label: record.label } : {}),
  };
  connectionLog("info", "removeSavedEnvironment", "Removing saved environment", logCtx);
  if (identityKey) {
    useSavedEnvironmentRegistryStore.getState().remove(identityKey);
    useSavedProjectRegistryStore.getState().removeByEnvironment(identityKey);
    await removeSavedEnvironmentBearerToken({ identityKey, environmentId });
  } else {
    // No registry entry — best-effort cleanup keyed by environmentId only.
    await ensureLocalApi().persistence.removeSavedEnvironmentSecret(environmentId);
  }
  await disconnectSavedEnvironment(environmentId);
  connectionLog("info", "removeSavedEnvironment", "Removed", logCtx);
}

export async function addOrReconnectSavedEnvironment(input: {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
  readonly sshConfig?: SshEnvironmentConfig;
  readonly label?: string;
  readonly projectId: string;
}): Promise<{ record: SavedRemoteEnvironment; isReconnect: boolean }> {
  connectionLog("info", "addOrReconnectSavedEnvironment", "Start", {
    detail: { host: input.host, label: input.label },
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
  const logCtx = { identityKey, label: input.label ?? descriptor.label };

  // 4. Check if this identity already exists
  const existingRecord =
    useSavedEnvironmentRegistryStore.getState().byIdentityKey[identityKey] ?? null;
  connectionLog(
    "info",
    "addOrReconnectSavedEnvironment",
    existingRecord ? "Identity key matched existing record" : "No existing record — new environment",
    logCtx,
  );

  // 5. If existing and environmentId changed, disconnect old connection
  if (existingRecord?.environmentId && existingRecord.environmentId !== environmentId) {
    connectionLog("info", "addOrReconnectSavedEnvironment", "Disconnecting old environment (ID changed)", {
      ...logCtx,
      detail: { oldEnvironmentId: existingRecord.environmentId, newEnvironmentId: environmentId },
    });
    await disconnectSavedEnvironment(existingRecord.environmentId).catch(() => {});
  }

  // 6. Bootstrap bearer session
  connectionLog("info", "addOrReconnectSavedEnvironment", "Bootstrapping bearer session", logCtx);
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
    ...(input.sshConfig ? { sshConfig: input.sshConfig } : {}),
  };

  // 8. Persist
  connectionLog("info", "addOrReconnectSavedEnvironment", "Persisting record and bearer token", logCtx);
  await persistSavedEnvironmentRecord(record);
  const didPersistBearerToken = await writeSavedEnvironmentBearerToken(
    record,
    bearerSession.sessionToken,
  );
  if (!didPersistBearerToken) {
    connectionLog("error", "addOrReconnectSavedEnvironment", "Failed to persist bearer token", logCtx);
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
  connectionLog("info", "addOrReconnectSavedEnvironment", "Connecting", logCtx);
  await ensureSavedEnvironmentConnection(record, {
    bearerToken: bearerSession.sessionToken,
    role: bearerSession.role,
  });

  // 10. Update store
  useSavedEnvironmentRegistryStore.getState().upsert(record);

  connectionLog("info", "addOrReconnectSavedEnvironment", `Completed (${existingRecord ? "reconnect" : "new"})`, logCtx);
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
  for (const key of Array.from(threadDetailSubscriptions.keys())) {
    disposeThreadDetailSubscriptionByKey(key);
  }
  await Promise.all(
    [...environmentConnections.keys()].map((environmentId) => removeConnection(environmentId)),
  );
}
