import { getKnownEnvironmentHttpBaseUrl } from "@t3tools/client-runtime";
import type {
  AuthSessionRole,
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  PersistedSavedEnvironmentRecord,
  SavedRemoteEnvironment,
  ServerConfig,
} from "@t3tools/contracts";
import type { ConnectionErrorCategory } from "../../lib/connectionErrorClassifier";
import { type RemoteIdentityKey, makeRemoteIdentityKey } from "@t3tools/contracts";
import { create } from "zustand";

import { resolveLocalApi as ensureLocalApi } from "./localApiBridge";
import { getPrimaryKnownEnvironment } from "../primary";

export type SavedEnvironmentRecord = SavedRemoteEnvironment;

interface SavedEnvironmentRegistryState {
  readonly byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>;
  readonly identityKeyByEnvironmentId: Record<EnvironmentId, RemoteIdentityKey>;
  /**
   * @deprecated Use `byIdentityKey` with `identityKeyByEnvironmentId` for lookups.
   * This derived view is kept temporarily for UI callers that still reference
   * `state.byId[environmentId]`. It will be removed in a future task.
   */
  readonly byId: Record<EnvironmentId, SavedRemoteEnvironment>;
}

interface SavedEnvironmentRegistryStore extends SavedEnvironmentRegistryState {
  readonly upsert: (record: SavedRemoteEnvironment) => void;
  readonly remove: (identityKey: RemoteIdentityKey) => void;
  readonly markConnected: (identityKey: RemoteIdentityKey, connectedAt: string) => void;
  readonly findByEnvironmentId: (environmentId: EnvironmentId) => SavedRemoteEnvironment | null;
  readonly reset: () => void;
}

let savedEnvironmentRegistryHydrated = false;
let savedEnvironmentRegistryHydrationPromise: Promise<void> | null = null;

/** @internal Exported for testing only. */
export function toPersistedSavedEnvironmentRecord(
  record: SavedRemoteEnvironment,
): PersistedSavedEnvironmentRecord {
  return {
    environmentId: record.environmentId!,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl ?? "",
    wsBaseUrl: record.wsBaseUrl ?? "",
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
    ...(record.sshConfig ? { sshConfig: record.sshConfig } : {}),
  };
}

/** @internal Exported for testing only. */
export function migratePersistedRecord(
  record: PersistedSavedEnvironmentRecord,
): SavedRemoteEnvironment {
  const sshConfig = record.sshConfig;
  const identityKey = sshConfig
    ? makeRemoteIdentityKey(sshConfig)
    : makeRemoteIdentityKey({
        host: new URL(record.httpBaseUrl).hostname,
        user: "unknown",
        port: 22,
        workspaceRoot: "/",
      });

  return {
    identityKey,
    host: sshConfig?.host ?? new URL(record.httpBaseUrl).hostname,
    user: sshConfig?.user ?? "unknown",
    port: sshConfig?.port ?? 22,
    workspaceRoot: sshConfig?.workspaceRoot ?? "/",
    label: record.label,
    createdAt: record.createdAt,
    environmentId: record.environmentId,
    wsBaseUrl: record.wsBaseUrl,
    httpBaseUrl: record.httpBaseUrl,
    lastConnectedAt: record.lastConnectedAt,
    projectId: sshConfig?.projectId ?? record.environmentId,
  };
}

function deriveByIdIndex(
  byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>,
): Record<EnvironmentId, SavedRemoteEnvironment> {
  const byId: Record<EnvironmentId, SavedRemoteEnvironment> = {};
  for (const record of Object.values(byIdentityKey)) {
    if (record.environmentId) {
      byId[record.environmentId] = record;
    }
  }
  return byId;
}

function deriveReverseIndex(
  byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>,
): Record<EnvironmentId, RemoteIdentityKey> {
  const index: Record<EnvironmentId, RemoteIdentityKey> = {};
  for (const record of Object.values(byIdentityKey)) {
    if (record.environmentId) {
      index[record.environmentId] = record.identityKey;
    }
  }
  return index;
}

function valuesOfSavedEnvironmentRegistry(
  byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>,
): ReadonlyArray<SavedRemoteEnvironment> {
  return Object.values(byIdentityKey) as ReadonlyArray<SavedRemoteEnvironment>;
}

function persistSavedEnvironmentRegistryState(
  byIdentityKey: Record<RemoteIdentityKey, SavedRemoteEnvironment>,
): void {
  try {
    const records = valuesOfSavedEnvironmentRegistry(byIdentityKey).filter(
      (record) => record.environmentId !== null,
    );
    void ensureLocalApi()
      .persistence.setSavedEnvironmentRegistry(
        records.map((record) => toPersistedSavedEnvironmentRecord(record)),
      )
      .catch((error) => {
        console.error("[SAVED_ENVIRONMENTS] persist failed", error);
      });
  } catch (error) {
    console.error("[SAVED_ENVIRONMENTS] persist failed", error);
  }
}

function replaceSavedEnvironmentRegistryState(
  records: ReadonlyArray<SavedRemoteEnvironment>,
): void {
  const currentByIdentityKey = useSavedEnvironmentRegistryStore.getState().byIdentityKey;
  const hydratedByIdentityKey = Object.fromEntries(
    records.map((record) => [record.identityKey, record]),
  ) as Record<RemoteIdentityKey, SavedRemoteEnvironment>;
  const merged = {
    ...hydratedByIdentityKey,
    ...currentByIdentityKey,
  };
  useSavedEnvironmentRegistryStore.setState({
    byIdentityKey: merged,
    identityKeyByEnvironmentId: deriveReverseIndex(merged),
    byId: deriveByIdIndex(merged),
  });
}

async function hydrateSavedEnvironmentRegistry(): Promise<void> {
  if (savedEnvironmentRegistryHydrated) {
    return;
  }
  if (savedEnvironmentRegistryHydrationPromise) {
    return savedEnvironmentRegistryHydrationPromise;
  }

  const nextHydration = (async () => {
    try {
      const persistedRecords = await ensureLocalApi().persistence.getSavedEnvironmentRegistry();
      const migratedRecords = persistedRecords.map(migratePersistedRecord);
      replaceSavedEnvironmentRegistryState(migratedRecords);
    } catch (error) {
      console.error("[SAVED_ENVIRONMENTS] hydrate failed", error);
    } finally {
      savedEnvironmentRegistryHydrated = true;
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (savedEnvironmentRegistryHydrationPromise === hydrationPromise) {
      savedEnvironmentRegistryHydrationPromise = null;
    }
  });
  savedEnvironmentRegistryHydrationPromise = hydrationPromise;

  return savedEnvironmentRegistryHydrationPromise;
}

export const useSavedEnvironmentRegistryStore = create<SavedEnvironmentRegistryStore>()(
  (set, get) => ({
    byIdentityKey: {},
    identityKeyByEnvironmentId: {},
    byId: {},
    upsert: (record) =>
      set((state) => {
        const byIdentityKey = {
          ...state.byIdentityKey,
          [record.identityKey]: record,
        };
        persistSavedEnvironmentRegistryState(byIdentityKey);
        return {
          byIdentityKey,
          identityKeyByEnvironmentId: deriveReverseIndex(byIdentityKey),
          byId: deriveByIdIndex(byIdentityKey),
        };
      }),
    remove: (identityKey) =>
      set((state) => {
        const { [identityKey]: _removed, ...remaining } = state.byIdentityKey;
        persistSavedEnvironmentRegistryState(remaining);
        return {
          byIdentityKey: remaining,
          identityKeyByEnvironmentId: deriveReverseIndex(remaining),
          byId: deriveByIdIndex(remaining),
        };
      }),
    markConnected: (identityKey, connectedAt) =>
      set((state) => {
        const existing = state.byIdentityKey[identityKey];
        if (!existing) {
          return state;
        }
        const byIdentityKey = {
          ...state.byIdentityKey,
          [identityKey]: {
            ...existing,
            lastConnectedAt: connectedAt,
          },
        };
        persistSavedEnvironmentRegistryState(byIdentityKey);
        return {
          byIdentityKey,
          identityKeyByEnvironmentId: deriveReverseIndex(byIdentityKey),
          byId: deriveByIdIndex(byIdentityKey),
        };
      }),
    findByEnvironmentId: (environmentId) => {
      const identityKey = get().identityKeyByEnvironmentId[environmentId];
      if (!identityKey) return null;
      return get().byIdentityKey[identityKey] ?? null;
    },
    reset: () => {
      persistSavedEnvironmentRegistryState({});
      set({
        byIdentityKey: {},
        identityKeyByEnvironmentId: {},
        byId: {},
      });
    },
  }),
);

export function hasSavedEnvironmentRegistryHydrated(): boolean {
  return savedEnvironmentRegistryHydrated;
}

export function waitForSavedEnvironmentRegistryHydration(): Promise<void> {
  if (hasSavedEnvironmentRegistryHydrated()) {
    return Promise.resolve();
  }

  return hydrateSavedEnvironmentRegistry();
}

export function listSavedEnvironmentRecords(): ReadonlyArray<SavedRemoteEnvironment> {
  return Object.values(useSavedEnvironmentRegistryStore.getState().byIdentityKey).toSorted(
    (left, right) => left.label.localeCompare(right.label),
  );
}

export function getSavedEnvironmentRecord(
  environmentId: EnvironmentId,
): SavedRemoteEnvironment | null {
  return useSavedEnvironmentRegistryStore.getState().findByEnvironmentId(environmentId);
}

export function getEnvironmentHttpBaseUrl(environmentId: EnvironmentId): string | null {
  const primaryEnvironment = getPrimaryKnownEnvironment();
  if (primaryEnvironment?.environmentId === environmentId) {
    return getKnownEnvironmentHttpBaseUrl(primaryEnvironment);
  }

  return getSavedEnvironmentRecord(environmentId)?.httpBaseUrl ?? null;
}

export function resolveEnvironmentHttpUrl(input: {
  readonly environmentId: EnvironmentId;
  readonly pathname: string;
  readonly searchParams?: Record<string, string>;
}): string {
  const httpBaseUrl = getEnvironmentHttpBaseUrl(input.environmentId);
  if (!httpBaseUrl) {
    throw new Error(`Unable to resolve HTTP base URL for environment ${input.environmentId}.`);
  }

  const url = new URL(httpBaseUrl);
  url.pathname = input.pathname;
  if (input.searchParams) {
    url.search = new URLSearchParams(input.searchParams).toString();
  }
  return url.toString();
}

export function resetSavedEnvironmentRegistryStoreForTests() {
  savedEnvironmentRegistryHydrated = false;
  savedEnvironmentRegistryHydrationPromise = null;
  useSavedEnvironmentRegistryStore.setState({
    byIdentityKey: {},
    identityKeyByEnvironmentId: {},
    byId: {},
  });
}

export async function persistSavedEnvironmentRecord(record: SavedRemoteEnvironment): Promise<void> {
  const byIdentityKey = {
    ...useSavedEnvironmentRegistryStore.getState().byIdentityKey,
    [record.identityKey]: record,
  };

  const records = valuesOfSavedEnvironmentRegistry(byIdentityKey).filter(
    (entry) => entry.environmentId !== null,
  );
  await ensureLocalApi().persistence.setSavedEnvironmentRegistry(
    records.map((entry) => toPersistedSavedEnvironmentRecord(entry)),
  );
}

/**
 * Minimal shape required to locate a saved environment's bearer token.
 *
 * Credentials are keyed by `identityKey` (stable across server-side
 * environmentId rotations). `environmentId` is used only as a legacy fallback
 * for records persisted before identity-based keying existed.
 */
type BearerTokenLocator = Pick<SavedRemoteEnvironment, "identityKey" | "environmentId">;

/**
 * Reads the bearer token for a saved environment.
 *
 * Lookup order:
 *   1. `identityKey` (the stable primary key)
 *   2. `environmentId` (legacy fallback, for tokens saved before the
 *      identity-key migration)
 *
 * On fallback hit, the token is self-healed: rewritten under `identityKey`
 * and the stale `environmentId` entry is removed, so subsequent reconnects
 * go through the fast path.
 */
export async function readSavedEnvironmentBearerToken(
  record: BearerTokenLocator,
): Promise<string | null> {
  const persistence = ensureLocalApi().persistence;

  const byIdentity = await persistence.getSavedEnvironmentSecret(record.identityKey);
  if (byIdentity) {
    return byIdentity;
  }

  if (record.environmentId) {
    const byEnvironmentId = await persistence.getSavedEnvironmentSecret(record.environmentId);
    if (byEnvironmentId) {
      // Self-heal: move the legacy entry under the stable identityKey.
      try {
        await persistence.setSavedEnvironmentSecret(record.identityKey, byEnvironmentId);
        await persistence.removeSavedEnvironmentSecret(record.environmentId);
      } catch (error) {
        console.error("[SAVED_ENVIRONMENTS] credential self-heal failed", error);
      }
      return byEnvironmentId;
    }
  }

  return null;
}

export async function writeSavedEnvironmentBearerToken(
  record: Pick<SavedRemoteEnvironment, "identityKey">,
  bearerToken: string,
): Promise<boolean> {
  return ensureLocalApi().persistence.setSavedEnvironmentSecret(record.identityKey, bearerToken);
}

export async function removeSavedEnvironmentBearerToken(record: BearerTokenLocator): Promise<void> {
  const persistence = ensureLocalApi().persistence;
  await persistence.removeSavedEnvironmentSecret(record.identityKey);
  if (record.environmentId) {
    // Clean up any pre-migration entry that may still be keyed by environmentId.
    await persistence.removeSavedEnvironmentSecret(record.environmentId);
  }
}

export type SavedEnvironmentConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type SavedEnvironmentAuthState = "authenticated" | "requires-auth" | "unknown";

export interface SavedEnvironmentRuntimeState {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly authState: SavedEnvironmentAuthState;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly errorCategory: ConnectionErrorCategory | null;
  readonly errorGuidance: string | null;
  readonly role: AuthSessionRole | null;
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
  readonly serverConfig: ServerConfig | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
}

interface SavedEnvironmentRuntimeStoreState {
  readonly byId: Record<EnvironmentId, SavedEnvironmentRuntimeState>;
  readonly ensure: (environmentId: EnvironmentId) => void;
  readonly patch: (
    environmentId: EnvironmentId,
    patch: Partial<SavedEnvironmentRuntimeState>,
  ) => void;
  readonly clear: (environmentId: EnvironmentId) => void;
  readonly reset: () => void;
}

const DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE: SavedEnvironmentRuntimeState = Object.freeze({
  connectionState: "disconnected",
  authState: "unknown",
  lastError: null,
  lastErrorAt: null,
  errorCategory: null,
  errorGuidance: null,
  role: null,
  descriptor: null,
  serverConfig: null,
  connectedAt: null,
  disconnectedAt: null,
});

function createDefaultSavedEnvironmentRuntimeState(): SavedEnvironmentRuntimeState {
  return {
    ...DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE,
  };
}

export const useSavedEnvironmentRuntimeStore = create<SavedEnvironmentRuntimeStoreState>()(
  (set) => ({
    byId: {},
    ensure: (environmentId) =>
      set((state) => {
        if (state.byId[environmentId]) {
          return state;
        }
        return {
          byId: {
            ...state.byId,
            [environmentId]: createDefaultSavedEnvironmentRuntimeState(),
          },
        };
      }),
    patch: (environmentId, patch) =>
      set((state) => ({
        byId: {
          ...state.byId,
          [environmentId]: {
            ...(state.byId[environmentId] ?? createDefaultSavedEnvironmentRuntimeState()),
            ...patch,
          },
        },
      })),
    clear: (environmentId) =>
      set((state) => {
        const { [environmentId]: _removed, ...remaining } = state.byId;
        return {
          byId: remaining,
        };
      }),
    reset: () =>
      set({
        byId: {},
      }),
  }),
);

export function getSavedEnvironmentRuntimeState(
  environmentId: EnvironmentId,
): SavedEnvironmentRuntimeState {
  return (
    useSavedEnvironmentRuntimeStore.getState().byId[environmentId] ??
    DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE
  );
}

export function resetSavedEnvironmentRuntimeStoreForTests() {
  useSavedEnvironmentRuntimeStore.getState().reset();
}
