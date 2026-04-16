import {
  EnvironmentId,
  ProjectId,
  type LocalApi,
  type PersistedSavedProjectRecord,
  type SavedRemoteProject,
  makeRemoteIdentityKey,
  makeSavedProjectKey,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  hasSavedProjectRegistryHydrated,
  listSavedProjectRecordsForEnvironment,
  resetSavedProjectRegistryStoreForTests,
  useSavedProjectRegistryStore,
  waitForSavedProjectRegistryHydration,
} from "../projectsCatalog";

const ENV_A = makeRemoteIdentityKey({
  host: "a.example.com",
  user: "james",
  port: 22,
  workspaceRoot: "/srv/a",
});
const ENV_B = makeRemoteIdentityKey({
  host: "b.example.com",
  user: "james",
  port: 22,
  workspaceRoot: "/srv/b",
});

function makeProject(overrides: {
  environmentIdentityKey?: typeof ENV_A;
  projectId?: string;
  name?: string;
  workspaceRoot?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastSyncedEnvironmentId?: EnvironmentId | null;
}): SavedRemoteProject {
  const environmentIdentityKey = overrides.environmentIdentityKey ?? ENV_A;
  const projectId = ProjectId.make(overrides.projectId ?? "proj-1");
  return {
    savedProjectKey: makeSavedProjectKey({ environmentIdentityKey, projectId }),
    environmentIdentityKey,
    projectId,
    name: overrides.name ?? "Project 1",
    workspaceRoot: overrides.workspaceRoot ?? "/srv/a/proj-1",
    repositoryCanonicalKey: null,
    firstSeenAt: overrides.firstSeenAt ?? "2026-04-01T00:00:00.000Z",
    lastSeenAt: overrides.lastSeenAt ?? "2026-04-01T00:00:00.000Z",
    lastSyncedEnvironmentId: overrides.lastSyncedEnvironmentId ?? null,
  };
}

function makePersistedStub(): LocalApi["persistence"] {
  return {
    getClientSettings: async () => null,
    setClientSettings: async () => undefined,
    getSavedEnvironmentRegistry: async () => [],
    setSavedEnvironmentRegistry: async () => undefined,
    getSavedEnvironmentSecret: async () => null,
    setSavedEnvironmentSecret: async () => true,
    removeSavedEnvironmentSecret: async () => undefined,
    getSavedProjectRegistry: async () => [],
    setSavedProjectRegistry: async () => undefined,
  };
}

describe("useSavedProjectRegistryStore", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: makePersistedStub(),
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    resetSavedProjectRegistryStoreForTests();
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("upsertMany inserts records indexed by key and environment", () => {
    const project = makeProject({});
    useSavedProjectRegistryStore.getState().upsertMany([project]);

    const state = useSavedProjectRegistryStore.getState();
    expect(state.byKey[project.savedProjectKey]).toEqual(project);
    expect(state.keysByEnvironmentIdentityKey[ENV_A]).toEqual([project.savedProjectKey]);
  });

  it("upsertMany updates metadata for an existing project and preserves firstSeenAt", () => {
    const first = makeProject({
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      name: "Old",
    });
    useSavedProjectRegistryStore.getState().upsertMany([first]);

    const updated = makeProject({
      firstSeenAt: "2026-04-01T00:00:00.000Z", // caller should resend original firstSeenAt
      lastSeenAt: "2026-04-10T00:00:00.000Z",
      name: "New",
    });
    useSavedProjectRegistryStore.getState().upsertMany([updated]);

    const stored = useSavedProjectRegistryStore.getState().byKey[first.savedProjectKey];
    expect(stored?.name).toBe("New");
    expect(stored?.lastSeenAt).toBe("2026-04-10T00:00:00.000Z");
    expect(stored?.firstSeenAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("upsertMany does not duplicate keys in the environment index when re-upserting", () => {
    const project = makeProject({});
    useSavedProjectRegistryStore.getState().upsertMany([project]);
    useSavedProjectRegistryStore.getState().upsertMany([project]);

    expect(useSavedProjectRegistryStore.getState().keysByEnvironmentIdentityKey[ENV_A]).toHaveLength(
      1,
    );
  });

  it("pruneMissing removes only entries for the given environment whose projectIds are absent", () => {
    const projectA1 = makeProject({ projectId: "proj-a1", environmentIdentityKey: ENV_A });
    const projectA2 = makeProject({
      projectId: "proj-a2",
      environmentIdentityKey: ENV_A,
      name: "A2",
      workspaceRoot: "/srv/a/a2",
    });
    const projectB1 = makeProject({
      projectId: "proj-b1",
      environmentIdentityKey: ENV_B,
      name: "B1",
      workspaceRoot: "/srv/b/b1",
    });
    useSavedProjectRegistryStore.getState().upsertMany([projectA1, projectA2, projectB1]);

    useSavedProjectRegistryStore
      .getState()
      .pruneMissing(ENV_A, new Set([ProjectId.make("proj-a1")]));

    const state = useSavedProjectRegistryStore.getState();
    expect(state.byKey[projectA1.savedProjectKey]).toBeDefined();
    expect(state.byKey[projectA2.savedProjectKey]).toBeUndefined();
    expect(state.byKey[projectB1.savedProjectKey]).toBeDefined();
    expect(state.keysByEnvironmentIdentityKey[ENV_A]).toEqual([projectA1.savedProjectKey]);
    expect(state.keysByEnvironmentIdentityKey[ENV_B]).toEqual([projectB1.savedProjectKey]);
  });

  it("removeByEnvironment cascades all projects for one environment", () => {
    const projectA1 = makeProject({ projectId: "proj-a1", environmentIdentityKey: ENV_A });
    const projectB1 = makeProject({
      projectId: "proj-b1",
      environmentIdentityKey: ENV_B,
      name: "B1",
      workspaceRoot: "/srv/b/b1",
    });
    useSavedProjectRegistryStore.getState().upsertMany([projectA1, projectB1]);

    useSavedProjectRegistryStore.getState().removeByEnvironment(ENV_A);

    const state = useSavedProjectRegistryStore.getState();
    expect(state.byKey[projectA1.savedProjectKey]).toBeUndefined();
    expect(state.byKey[projectB1.savedProjectKey]).toBeDefined();
    expect(state.keysByEnvironmentIdentityKey[ENV_A]).toBeUndefined();
    expect(state.keysByEnvironmentIdentityKey[ENV_B]).toEqual([projectB1.savedProjectKey]);
  });

  it("listSavedProjectRecordsForEnvironment returns projects for a specific env sorted by name", () => {
    const projectA1 = makeProject({
      projectId: "proj-a1",
      environmentIdentityKey: ENV_A,
      name: "Zebra",
    });
    const projectA2 = makeProject({
      projectId: "proj-a2",
      environmentIdentityKey: ENV_A,
      name: "Apple",
    });
    const projectB1 = makeProject({
      projectId: "proj-b1",
      environmentIdentityKey: ENV_B,
      name: "Banana",
    });
    useSavedProjectRegistryStore.getState().upsertMany([projectA1, projectA2, projectB1]);

    const list = listSavedProjectRecordsForEnvironment(ENV_A);
    expect(list.map((entry) => entry.name)).toEqual(["Apple", "Zebra"]);
  });
});

describe("saved project registry hydration", () => {
  afterEach(async () => {
    resetSavedProjectRegistryStoreForTests();
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("hydrates records from persistence and exposes the hydrated flag", async () => {
    const persisted: PersistedSavedProjectRecord = {
      savedProjectKey: `${ENV_A}#proj-1`,
      environmentIdentityKey: ENV_A,
      projectId: "proj-1",
      name: "Persisted project",
      workspaceRoot: "/srv/a/proj-1",
      repositoryCanonicalKey: null,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastSyncedEnvironmentId: null,
    };

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          ...makePersistedStub(),
          getSavedProjectRegistry: async () => [persisted],
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();

    expect(hasSavedProjectRegistryHydrated()).toBe(false);
    await waitForSavedProjectRegistryHydration();
    expect(hasSavedProjectRegistryHydrated()).toBe(true);

    const state = useSavedProjectRegistryStore.getState();
    const stored = state.byKey[persisted.savedProjectKey as never];
    expect(stored?.name).toBe("Persisted project");
  });

  it("merges hydrated records with in-memory upserts, preferring the current in-memory record", async () => {
    const persisted: PersistedSavedProjectRecord = {
      savedProjectKey: `${ENV_A}#proj-1`,
      environmentIdentityKey: ENV_A,
      projectId: "proj-1",
      name: "Old persisted name",
      workspaceRoot: "/srv/a/proj-1",
      repositoryCanonicalKey: null,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastSyncedEnvironmentId: null,
    };

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          ...makePersistedStub(),
          getSavedProjectRegistry: async () => [persisted],
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();

    // Simulate a live upsert BEFORE hydration completes (merge precedence).
    const live = makeProject({ name: "Live name" });
    useSavedProjectRegistryStore.getState().upsertMany([live]);

    await waitForSavedProjectRegistryHydration();

    const stored = useSavedProjectRegistryStore.getState().byKey[live.savedProjectKey];
    expect(stored?.name).toBe("Live name");
  });
});
