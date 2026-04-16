import {
  EnvironmentId,
  type LocalApi,
  type PersistedSavedEnvironmentRecord,
  type RemoteIdentityKey,
} from "@t3tools/contracts";
import { makeRemoteIdentityKey } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  migratePersistedRecord,
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
  toPersistedSavedEnvironmentRecord,
  useSavedEnvironmentRegistryStore,
} from "../catalog";

function makeTestRecord(overrides: {
  environmentId?: EnvironmentId;
  label?: string;
  host?: string;
  user?: string;
  port?: number;
  workspaceRoot?: string;
  httpBaseUrl?: string;
  wsBaseUrl?: string;
}) {
  const host = overrides.host ?? "remote.example.com";
  const user = overrides.user ?? "james";
  const port = overrides.port ?? 22;
  const workspaceRoot = overrides.workspaceRoot ?? "/home/james/app";
  const environmentId = overrides.environmentId ?? EnvironmentId.make("environment-1");
  return {
    identityKey: makeRemoteIdentityKey({ host, user, port, workspaceRoot }),
    host,
    user,
    port,
    workspaceRoot,
    label: overrides.label ?? "Remote environment",
    createdAt: "2026-04-09T00:00:00.000Z",
    environmentId,
    wsBaseUrl: overrides.wsBaseUrl ?? "wss://remote.example.com/",
    httpBaseUrl: overrides.httpBaseUrl ?? "https://remote.example.com/",
    lastConnectedAt: null,
    projectId: environmentId as string,
  } as const;
}

describe("remote environment lifecycle integration", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
          getSavedProjectRegistry: async () => [],
          setSavedProjectRegistry: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  describe("makeRemoteIdentityKey produces stable keys", () => {
    it("returns the same key for identical inputs", () => {
      const fields = { host: "devbox", user: "james", port: 22, workspaceRoot: "/home/james/app" };
      const a = makeRemoteIdentityKey(fields);
      const b = makeRemoteIdentityKey(fields);
      expect(a).toBe(b);
    });

    it("returns different keys for different workspaces on the same host", () => {
      const base = { host: "devbox", user: "james", port: 22 };
      const a = makeRemoteIdentityKey({ ...base, workspaceRoot: "/home/james/app1" });
      const b = makeRemoteIdentityKey({ ...base, workspaceRoot: "/home/james/app2" });
      expect(a).not.toBe(b);
    });

    it("returns different keys for different ports on the same host", () => {
      const base = { host: "devbox", user: "james", workspaceRoot: "/opt/code" };
      const a = makeRemoteIdentityKey({ ...base, port: 22 });
      const b = makeRemoteIdentityKey({ ...base, port: 2222 });
      expect(a).not.toBe(b);
    });
  });

  describe("registry store upsert by identityKey", () => {
    it("creates a new entry on first upsert", () => {
      const record = makeTestRecord({});
      useSavedEnvironmentRegistryStore.getState().upsert(record);

      const stored = useSavedEnvironmentRegistryStore.getState().byIdentityKey[record.identityKey];
      expect(stored).toEqual(record);
    });

    it("updates an existing entry when upserting with the same identityKey", () => {
      const record = makeTestRecord({});
      useSavedEnvironmentRegistryStore.getState().upsert(record);

      const updated = {
        ...record,
        label: "Updated label",
        environmentId: EnvironmentId.make("environment-2"),
      };
      useSavedEnvironmentRegistryStore.getState().upsert(updated);

      const stored = useSavedEnvironmentRegistryStore.getState().byIdentityKey[record.identityKey];
      expect(stored?.label).toBe("Updated label");
      expect(stored?.environmentId).toBe("environment-2");
    });

    it("creates separate entries for different identityKeys", () => {
      const recordA = makeTestRecord({ host: "host-a", workspaceRoot: "/a" });
      const recordB = makeTestRecord({ host: "host-b", workspaceRoot: "/b" });

      useSavedEnvironmentRegistryStore.getState().upsert(recordA);
      useSavedEnvironmentRegistryStore.getState().upsert(recordB);

      const state = useSavedEnvironmentRegistryStore.getState();
      expect(Object.keys(state.byIdentityKey)).toHaveLength(2);
      expect(state.byIdentityKey[recordA.identityKey]).toBeDefined();
      expect(state.byIdentityKey[recordB.identityKey]).toBeDefined();
    });
  });

  describe("registry store reverse index", () => {
    it("populates identityKeyByEnvironmentId on upsert", () => {
      const envId = EnvironmentId.make("env-idx-1");
      const record = makeTestRecord({ environmentId: envId });

      useSavedEnvironmentRegistryStore.getState().upsert(record);

      expect(useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[envId]).toBe(
        record.identityKey,
      );
    });

    it("updates reverse index when environmentId changes for same identityKey", () => {
      const envId1 = EnvironmentId.make("env-old");
      const envId2 = EnvironmentId.make("env-new");
      const record = makeTestRecord({ environmentId: envId1 });

      useSavedEnvironmentRegistryStore.getState().upsert(record);
      useSavedEnvironmentRegistryStore.getState().upsert({ ...record, environmentId: envId2 });

      const state = useSavedEnvironmentRegistryStore.getState();
      expect(state.identityKeyByEnvironmentId[envId2]).toBe(record.identityKey);
      // Old environmentId should no longer be in the reverse index
      expect(state.identityKeyByEnvironmentId[envId1]).toBeUndefined();
    });
  });

  describe("findByEnvironmentId", () => {
    it("returns the correct record via the reverse index", () => {
      const envId = EnvironmentId.make("env-find-1");
      const record = makeTestRecord({ environmentId: envId });

      useSavedEnvironmentRegistryStore.getState().upsert(record);

      const found = useSavedEnvironmentRegistryStore.getState().findByEnvironmentId(envId);
      expect(found).toEqual(record);
    });

    it("returns null for an unknown environmentId", () => {
      const found = useSavedEnvironmentRegistryStore
        .getState()
        .findByEnvironmentId(EnvironmentId.make("nonexistent"));
      expect(found).toBeNull();
    });
  });

  describe("remove cleans both maps", () => {
    it("clears byIdentityKey, reverse index, and byId on remove", () => {
      const envId = EnvironmentId.make("env-rm-1");
      const record = makeTestRecord({ environmentId: envId });

      useSavedEnvironmentRegistryStore.getState().upsert(record);
      useSavedEnvironmentRegistryStore.getState().remove(record.identityKey);

      const state = useSavedEnvironmentRegistryStore.getState();
      expect(state.byIdentityKey[record.identityKey]).toBeUndefined();
      expect(state.identityKeyByEnvironmentId[envId]).toBeUndefined();
      expect(state.byId[envId]).toBeUndefined();
    });

    it("leaves other entries intact when removing one", () => {
      const recordA = makeTestRecord({
        environmentId: EnvironmentId.make("env-keep"),
        host: "host-keep",
      });
      const recordB = makeTestRecord({
        environmentId: EnvironmentId.make("env-remove"),
        host: "host-remove",
      });

      useSavedEnvironmentRegistryStore.getState().upsert(recordA);
      useSavedEnvironmentRegistryStore.getState().upsert(recordB);
      useSavedEnvironmentRegistryStore.getState().remove(recordB.identityKey);

      const state = useSavedEnvironmentRegistryStore.getState();
      expect(state.byIdentityKey[recordA.identityKey]).toEqual(recordA);
      expect(state.byIdentityKey[recordB.identityKey]).toBeUndefined();
    });
  });

  describe("migration roundtrip", () => {
    it("preserves data through migratePersistedRecord -> toPersistedSavedEnvironmentRecord", () => {
      const identityKey = makeRemoteIdentityKey({
        host: "server.io",
        user: "deploy",
        port: 2222,
        workspaceRoot: "/opt/app",
      });
      const original = {
        identityKey,
        host: "server.io",
        user: "deploy",
        port: 2222,
        workspaceRoot: "/opt/app",
        label: "production",
        createdAt: "2026-03-15T12:00:00Z",
        environmentId: EnvironmentId.make("env-rt"),
        wsBaseUrl: "ws://server.io:3773",
        httpBaseUrl: "http://server.io:3773",
        lastConnectedAt: "2026-03-15T13:00:00Z",
        projectId: "proj-rt",
      };

      const persisted = toPersistedSavedEnvironmentRecord(original);
      const restored = migratePersistedRecord(persisted);

      expect(restored.identityKey).toBe(original.identityKey);
      expect(restored.host).toBe(original.host);
      expect(restored.user).toBe(original.user);
      expect(restored.port).toBe(original.port);
      expect(restored.workspaceRoot).toBe(original.workspaceRoot);
      expect(restored.label).toBe(original.label);
      expect(restored.environmentId).toBe(original.environmentId);
      expect(restored.projectId).toBe(original.projectId);
      expect(restored.wsBaseUrl).toBe(original.wsBaseUrl);
      expect(restored.httpBaseUrl).toBe(original.httpBaseUrl);
      expect(restored.lastConnectedAt).toBe(original.lastConnectedAt);
      expect(restored.createdAt).toBe(original.createdAt);
    });

    it("preserves data through toPersistedSavedEnvironmentRecord -> migratePersistedRecord", () => {
      const persisted: PersistedSavedEnvironmentRecord = {
        environmentId: EnvironmentId.make("env-persist"),
        label: "devbox",
        wsBaseUrl: "ws://devbox:3773",
        httpBaseUrl: "http://devbox:3773",
        createdAt: "2026-01-01T00:00:00Z",
        lastConnectedAt: null,
        sshConfig: {
          host: "devbox",
          user: "root",
          port: 22,
          projectId: "proj-1",
          workspaceRoot: "/home/root/code",
        },
      };

      const migrated = migratePersistedRecord(persisted);
      const roundtripped = toPersistedSavedEnvironmentRecord(migrated);

      expect(roundtripped.environmentId).toBe(persisted.environmentId);
      expect(roundtripped.label).toBe(persisted.label);
      expect(roundtripped.wsBaseUrl).toBe(persisted.wsBaseUrl);
      expect(roundtripped.httpBaseUrl).toBe(persisted.httpBaseUrl);
      expect(roundtripped.createdAt).toBe(persisted.createdAt);
      expect(roundtripped.lastConnectedAt).toBe(persisted.lastConnectedAt);
      expect(roundtripped.sshConfig).toEqual(persisted.sshConfig);
    });
  });
});

describe("removeSavedEnvironment cascades to saved project registry", () => {
  beforeEach(async () => {
    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: async () => [],
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
          getSavedProjectRegistry: async () => [],
          setSavedProjectRegistry: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { resetSavedProjectRegistryStoreForTests } = await import("../projectsCatalog");
    resetSavedProjectRegistryStoreForTests();
    const { __resetLocalApiForTests } = await import("../../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("removes all saved projects under the environment's identity key", async () => {
    const { ProjectId, makeSavedProjectKey } = await import("@t3tools/contracts");
    const { useSavedProjectRegistryStore } = await import("../projectsCatalog");
    const { removeSavedEnvironment } = await import("../service");

    const envId = EnvironmentId.make("env-cascade");
    const record = makeTestRecord({ environmentId: envId });
    useSavedEnvironmentRegistryStore.getState().upsert(record);

    // Seed two saved projects under this environment
    const projectA = {
      savedProjectKey: makeSavedProjectKey({
        environmentIdentityKey: record.identityKey,
        projectId: ProjectId.make("proj-A"),
      }),
      environmentIdentityKey: record.identityKey,
      projectId: ProjectId.make("proj-A"),
      name: "A",
      workspaceRoot: "/srv/A",
      repositoryCanonicalKey: null,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastSyncedEnvironmentId: envId,
    };
    const projectB = {
      savedProjectKey: makeSavedProjectKey({
        environmentIdentityKey: record.identityKey,
        projectId: ProjectId.make("proj-B"),
      }),
      environmentIdentityKey: record.identityKey,
      projectId: ProjectId.make("proj-B"),
      name: "B",
      workspaceRoot: "/srv/B",
      repositoryCanonicalKey: null,
      firstSeenAt: "2026-04-01T00:00:00.000Z",
      lastSeenAt: "2026-04-01T00:00:00.000Z",
      lastSyncedEnvironmentId: envId,
    };
    useSavedProjectRegistryStore.getState().upsertMany([projectA, projectB]);
    expect(Object.keys(useSavedProjectRegistryStore.getState().byKey)).toHaveLength(2);

    await removeSavedEnvironment(envId);

    expect(useSavedProjectRegistryStore.getState().byKey).toEqual({});
    expect(
      useSavedProjectRegistryStore.getState().keysByEnvironmentIdentityKey[record.identityKey],
    ).toBeUndefined();
  });
});
