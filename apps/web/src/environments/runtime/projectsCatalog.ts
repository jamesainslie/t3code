import {
  EnvironmentId,
  ProjectId,
  type OrchestrationProject,
  type PersistedSavedProjectRecord,
  type RemoteIdentityKey,
  type SavedProjectKey,
  type SavedRemoteProject,
  makeSavedProjectKey,
  parseRemoteIdentityKey,
} from "@t3tools/contracts";
import { create } from "zustand";

import { ensureLocalApi } from "../../localApi";
import { useSavedEnvironmentRegistryStore } from "./catalog";

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

interface ProjectSyncInput {
  readonly id: ProjectId;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryCanonicalKey: string | null;
}

function syncSavedProjectsCore(
  environmentId: EnvironmentId,
  inputs: ReadonlyArray<ProjectSyncInput>,
): void {
  const identityKey =
    useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[environmentId];
  if (!identityKey) {
    return;
  }

  const now = new Date(Date.now()).toISOString();
  const records: SavedRemoteProject[] = inputs.map((input) => ({
    savedProjectKey: makeSavedProjectKey({
      environmentIdentityKey: identityKey,
      projectId: input.id,
    }),
    environmentIdentityKey: identityKey,
    projectId: input.id,
    name: input.name,
    workspaceRoot: input.workspaceRoot,
    repositoryCanonicalKey: input.repositoryCanonicalKey,
    firstSeenAt: now,
    lastSeenAt: now,
    lastSyncedEnvironmentId: environmentId,
  }));

  useSavedProjectRegistryStore.getState().upsertMany(records);

  const seenProjectIds = new Set(inputs.map((input) => input.id));
  useSavedProjectRegistryStore.getState().pruneMissing(identityKey, seenProjectIds);
}

/**
 * Projects a server-side read model's projects into the saved project registry.
 *
 * - Looks up the `environmentIdentityKey` for `environmentId` via the saved
 *   environment registry. If none exists, this is a no-op (the parent
 *   environment must be saved first).
 * - Upserts every non-deleted project (preserving `firstSeenAt` for existing
 *   records via `upsertMany`).
 * - Prunes any saved project for this environment whose `projectId` is not in
 *   the snapshot (the server is the authority for the active project set).
 */
export function syncSavedProjectsFromReadModel(
  projects: ReadonlyArray<OrchestrationProject>,
  environmentId: EnvironmentId,
): void {
  const activeProjects = projects.filter((project) => project.deletedAt === null);
  syncSavedProjectsCore(
    environmentId,
    activeProjects.map((project) => ({
      id: project.id,
      name: project.title,
      workspaceRoot: project.workspaceRoot,
      repositoryCanonicalKey: project.repositoryIdentity?.canonicalKey ?? null,
    })),
  );
}

/**
 * Web-store variant of {@link syncSavedProjectsFromReadModel}. Called from the
 * event-batch handler after `applyOrchestrationEvents` has updated the web
 * store — we re-derive the canonical set of projects for the environment and
 * project them into the saved registry using the same upsert + prune logic.
 */
export function syncSavedProjectsFromWebProjects(
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly name: string;
    readonly cwd: string;
    readonly repositoryIdentity?: { readonly canonicalKey: string } | null;
  }>,
  environmentId: EnvironmentId,
): void {
  syncSavedProjectsCore(
    environmentId,
    projects.map((project) => ({
      id: project.id,
      name: project.name,
      workspaceRoot: project.cwd,
      repositoryCanonicalKey: project.repositoryIdentity?.canonicalKey ?? null,
    })),
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
