import {
  EnvironmentId,
  ProjectId,
  type PersistedSavedProjectRecord,
  type RemoteIdentityKey,
  type SavedProjectKey,
  type SavedRemoteProject,
  makeSavedProjectKey,
  parseRemoteIdentityKey,
} from "@t3tools/contracts";
import { create } from "zustand";

import { ensureLocalApi } from "../../localApi";

interface SavedProjectRegistryState {
  readonly byKey: Record<SavedProjectKey, SavedRemoteProject>;
  readonly keysByEnvironmentIdentityKey: Record<RemoteIdentityKey, readonly SavedProjectKey[]>;
}

interface SavedProjectRegistryStore extends SavedProjectRegistryState {
  readonly upsertMany: (records: ReadonlyArray<SavedRemoteProject>) => void;
  readonly pruneMissing: (
    environmentIdentityKey: RemoteIdentityKey,
    seenProjectIds: ReadonlySet<ProjectId>,
  ) => void;
  readonly removeByEnvironment: (environmentIdentityKey: RemoteIdentityKey) => void;
  readonly reset: () => void;
}

let savedProjectRegistryHydrated = false;
let savedProjectRegistryHydrationPromise: Promise<void> | null = null;

function toPersistedSavedProjectRecord(
  record: SavedRemoteProject,
): PersistedSavedProjectRecord {
  return {
    savedProjectKey: record.savedProjectKey,
    environmentIdentityKey: record.environmentIdentityKey,
    projectId: record.projectId,
    name: record.name,
    workspaceRoot: record.workspaceRoot,
    repositoryCanonicalKey: record.repositoryCanonicalKey,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    lastSyncedEnvironmentId: record.lastSyncedEnvironmentId,
  };
}

function migratePersistedRecord(
  record: PersistedSavedProjectRecord,
): SavedRemoteProject | null {
  const environmentIdentityKey = parseRemoteIdentityKey(record.environmentIdentityKey);
  if (!environmentIdentityKey) return null;
  const projectId = ProjectId.make(record.projectId);
  return {
    savedProjectKey: makeSavedProjectKey({
      environmentIdentityKey: record.environmentIdentityKey as RemoteIdentityKey,
      projectId,
    }),
    environmentIdentityKey: record.environmentIdentityKey as RemoteIdentityKey,
    projectId,
    name: record.name,
    workspaceRoot: record.workspaceRoot,
    repositoryCanonicalKey: record.repositoryCanonicalKey,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    lastSyncedEnvironmentId: record.lastSyncedEnvironmentId
      ? EnvironmentId.make(record.lastSyncedEnvironmentId)
      : null,
  };
}

function rebuildEnvironmentIndex(
  byKey: Record<SavedProjectKey, SavedRemoteProject>,
): Record<RemoteIdentityKey, readonly SavedProjectKey[]> {
  const index: Record<RemoteIdentityKey, SavedProjectKey[]> = {};
  for (const record of Object.values(byKey)) {
    const bucket = index[record.environmentIdentityKey] ?? [];
    bucket.push(record.savedProjectKey);
    index[record.environmentIdentityKey] = bucket;
  }
  return index;
}

function persistSavedProjectRegistryState(
  byKey: Record<SavedProjectKey, SavedRemoteProject>,
): void {
  try {
    const records = Object.values(byKey).map(toPersistedSavedProjectRecord);
    void ensureLocalApi()
      .persistence.setSavedProjectRegistry(records)
      .catch((error) => {
        console.error("[SAVED_PROJECTS] persist failed", error);
      });
  } catch (error) {
    console.error("[SAVED_PROJECTS] persist failed", error);
  }
}

function replaceSavedProjectRegistryState(
  records: ReadonlyArray<SavedRemoteProject>,
): void {
  const currentByKey = useSavedProjectRegistryStore.getState().byKey;
  const hydratedByKey = Object.fromEntries(
    records.map((record) => [record.savedProjectKey, record]),
  ) as Record<SavedProjectKey, SavedRemoteProject>;
  // Merge precedence: current in-memory wins over hydrated persisted records.
  const merged = {
    ...hydratedByKey,
    ...currentByKey,
  };
  useSavedProjectRegistryStore.setState({
    byKey: merged,
    keysByEnvironmentIdentityKey: rebuildEnvironmentIndex(merged),
  });
}

async function hydrateSavedProjectRegistry(): Promise<void> {
  if (savedProjectRegistryHydrated) {
    return;
  }
  if (savedProjectRegistryHydrationPromise) {
    return savedProjectRegistryHydrationPromise;
  }

  const nextHydration = (async () => {
    try {
      const persistedRecords = await ensureLocalApi().persistence.getSavedProjectRegistry();
      const migratedRecords = persistedRecords
        .map(migratePersistedRecord)
        .filter((record): record is SavedRemoteProject => record !== null);
      replaceSavedProjectRegistryState(migratedRecords);
    } catch (error) {
      console.error("[SAVED_PROJECTS] hydrate failed", error);
    } finally {
      savedProjectRegistryHydrated = true;
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (savedProjectRegistryHydrationPromise === hydrationPromise) {
      savedProjectRegistryHydrationPromise = null;
    }
  });
  savedProjectRegistryHydrationPromise = hydrationPromise;

  return savedProjectRegistryHydrationPromise;
}

export const useSavedProjectRegistryStore = create<SavedProjectRegistryStore>()((set) => ({
  byKey: {},
  keysByEnvironmentIdentityKey: {},
  upsertMany: (records) =>
    set((state) => {
      if (records.length === 0) {
        return state;
      }
      const byKey: Record<SavedProjectKey, SavedRemoteProject> = { ...state.byKey };
      for (const record of records) {
        const existing = byKey[record.savedProjectKey];
        byKey[record.savedProjectKey] = existing
          ? {
              ...record,
              firstSeenAt: existing.firstSeenAt,
            }
          : record;
      }
      persistSavedProjectRegistryState(byKey);
      return {
        byKey,
        keysByEnvironmentIdentityKey: rebuildEnvironmentIndex(byKey),
      };
    }),
  pruneMissing: (environmentIdentityKey, seenProjectIds) =>
    set((state) => {
      const byKey: Record<SavedProjectKey, SavedRemoteProject> = { ...state.byKey };
      let changed = false;
      for (const [key, record] of Object.entries(byKey) as Array<
        [SavedProjectKey, SavedRemoteProject]
      >) {
        if (
          record.environmentIdentityKey === environmentIdentityKey &&
          !seenProjectIds.has(record.projectId)
        ) {
          delete byKey[key];
          changed = true;
        }
      }
      if (!changed) {
        return state;
      }
      persistSavedProjectRegistryState(byKey);
      return {
        byKey,
        keysByEnvironmentIdentityKey: rebuildEnvironmentIndex(byKey),
      };
    }),
  removeByEnvironment: (environmentIdentityKey) =>
    set((state) => {
      const byKey: Record<SavedProjectKey, SavedRemoteProject> = { ...state.byKey };
      let changed = false;
      for (const [key, record] of Object.entries(byKey) as Array<
        [SavedProjectKey, SavedRemoteProject]
      >) {
        if (record.environmentIdentityKey === environmentIdentityKey) {
          delete byKey[key];
          changed = true;
        }
      }
      if (!changed) {
        return state;
      }
      persistSavedProjectRegistryState(byKey);
      return {
        byKey,
        keysByEnvironmentIdentityKey: rebuildEnvironmentIndex(byKey),
      };
    }),
  reset: () => {
    persistSavedProjectRegistryState({});
    set({
      byKey: {},
      keysByEnvironmentIdentityKey: {},
    });
  },
}));

export function hasSavedProjectRegistryHydrated(): boolean {
  return savedProjectRegistryHydrated;
}

export function waitForSavedProjectRegistryHydration(): Promise<void> {
  if (hasSavedProjectRegistryHydrated()) {
    return Promise.resolve();
  }
  return hydrateSavedProjectRegistry();
}

export function listSavedProjectRecordsForEnvironment(
  environmentIdentityKey: RemoteIdentityKey,
): ReadonlyArray<SavedRemoteProject> {
  const state = useSavedProjectRegistryStore.getState();
  const keys = state.keysByEnvironmentIdentityKey[environmentIdentityKey] ?? [];
  return keys
    .map((key) => state.byKey[key])
    .filter((record): record is SavedRemoteProject => record !== undefined)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export function listAllSavedProjectRecords(): ReadonlyArray<SavedRemoteProject> {
  return Object.values(useSavedProjectRegistryStore.getState().byKey).toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function resetSavedProjectRegistryStoreForTests() {
  savedProjectRegistryHydrated = false;
  savedProjectRegistryHydrationPromise = null;
  useSavedProjectRegistryStore.setState({
    byKey: {},
    keysByEnvironmentIdentityKey: {},
  });
}
