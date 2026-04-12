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
  useSavedEnvironmentRuntimeStore,
  waitForSavedEnvironmentRegistryHydration,
} from "./catalog";

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

describe("environment runtime catalog stores", () => {
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
        },
      } satisfies Pick<LocalApi, "persistence">,
    });
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    resetSavedEnvironmentRegistryStoreForTests();
    resetSavedEnvironmentRuntimeStoreForTests();
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("resets the saved environment registry store state", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const record = makeTestRecord({ environmentId });

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    expect(useSavedEnvironmentRegistryStore.getState().byIdentityKey[record.identityKey]).toBeDefined();
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toBeDefined();

    resetSavedEnvironmentRegistryStoreForTests();

    expect(useSavedEnvironmentRegistryStore.getState().byIdentityKey).toEqual({});
    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({});
  });

  it("resets the saved environment runtime store state", () => {
    const environmentId = EnvironmentId.make("environment-1");

    useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
      connectionState: "connected",
      connectedAt: "2026-04-09T00:00:00.000Z",
    });

    expect(useSavedEnvironmentRuntimeStore.getState().byId[environmentId]).toBeDefined();

    resetSavedEnvironmentRuntimeStoreForTests();

    expect(useSavedEnvironmentRuntimeStore.getState().byId).toEqual({});
  });

  it("does not throw when local api lookup fails during registry persistence", async () => {
    vi.unstubAllGlobals();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    expect(() =>
      useSavedEnvironmentRegistryStore.getState().upsert(makeTestRecord({})),
    ).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith("[SAVED_ENVIRONMENTS] persist failed", expect.any(Error));
  });

  it("does not let stale hydration overwrite records added while hydration is in flight", async () => {
    let resolveRegistryRead: () => void = () => {
      throw new Error("Registry read resolver was not initialized.");
    };

    vi.stubGlobal("window", {
      nativeApi: {
        persistence: {
          getClientSettings: async () => null,
          setClientSettings: async () => undefined,
          getSavedEnvironmentRegistry: () =>
            new Promise<readonly PersistedSavedEnvironmentRecord[]>((resolve) => {
              resolveRegistryRead = () => resolve([]);
            }),
          setSavedEnvironmentRegistry: async () => undefined,
          getSavedEnvironmentSecret: async () => null,
          setSavedEnvironmentSecret: async () => true,
          removeSavedEnvironmentSecret: async () => undefined,
        },
      } satisfies Pick<LocalApi, "persistence">,
    });

    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();

    const hydrationPromise = waitForSavedEnvironmentRegistryHydration();

    const environmentId = EnvironmentId.make("environment-1");
    const record = makeTestRecord({ environmentId });

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    resolveRegistryRead();
    await hydrationPromise;

    expect(useSavedEnvironmentRegistryStore.getState().byIdentityKey[record.identityKey]).toEqual(record);
    expect(useSavedEnvironmentRegistryStore.getState().byId[environmentId]).toEqual(record);
  });

  it("maintains the identityKeyByEnvironmentId reverse index", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const record = makeTestRecord({ environmentId });

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    expect(
      useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[environmentId],
    ).toBe(record.identityKey);
  });

  it("findByEnvironmentId looks up via reverse index", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const record = makeTestRecord({ environmentId });

    useSavedEnvironmentRegistryStore.getState().upsert(record);

    expect(
      useSavedEnvironmentRegistryStore.getState().findByEnvironmentId(environmentId),
    ).toEqual(record);
  });

  it("remove by identityKey clears both maps", () => {
    const environmentId = EnvironmentId.make("environment-1");
    const record = makeTestRecord({ environmentId });

    useSavedEnvironmentRegistryStore.getState().upsert(record);
    useSavedEnvironmentRegistryStore.getState().remove(record.identityKey);

    expect(useSavedEnvironmentRegistryStore.getState().byIdentityKey).toEqual({});
    expect(useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId).toEqual({});
    expect(useSavedEnvironmentRegistryStore.getState().byId).toEqual({});
  });
});

describe("migratePersistedRecord", () => {
  it("migrates record with sshConfig", () => {
    const persisted: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("env-1"),
      label: "devbox",
      wsBaseUrl: "ws://localhost:59955",
      httpBaseUrl: "http://localhost:59955",
      createdAt: "2026-01-01T00:00:00Z",
      lastConnectedAt: "2026-01-01T00:00:00Z",
      sshConfig: {
        host: "devbox",
        user: "james",
        port: 22,
        projectId: "proj-1",
        workspaceRoot: "/home/james/app",
      },
    };
    const result = migratePersistedRecord(persisted);
    expect(result.identityKey).toBe("james@devbox:22:/home/james/app");
    expect(result.environmentId).toBe("env-1");
    expect(result.projectId).toBe("proj-1");
    expect(result.host).toBe("devbox");
    expect(result.user).toBe("james");
    expect(result.port).toBe(22);
    expect(result.workspaceRoot).toBe("/home/james/app");
    expect(result.label).toBe("devbox");
    expect(result.wsBaseUrl).toBe("ws://localhost:59955");
    expect(result.httpBaseUrl).toBe("http://localhost:59955");
    expect(result.lastConnectedAt).toBe("2026-01-01T00:00:00Z");
    expect(result.createdAt).toBe("2026-01-01T00:00:00Z");
  });

  it("migrates record without sshConfig", () => {
    const persisted: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("env-2"),
      label: "manual",
      wsBaseUrl: "ws://192.168.1.10:3773",
      httpBaseUrl: "http://192.168.1.10:3773",
      createdAt: "2026-01-01T00:00:00Z",
      lastConnectedAt: null,
    };
    const result = migratePersistedRecord(persisted);
    expect(result.identityKey).toContain("192.168.1.10");
    expect(result.environmentId).toBe("env-2");
    expect(result.host).toBe("192.168.1.10");
    expect(result.user).toBe("unknown");
    expect(result.port).toBe(22);
    expect(result.workspaceRoot).toBe("/");
    expect(result.label).toBe("manual");
    expect(result.lastConnectedAt).toBeNull();
  });

  it("derives projectId from sshConfig when present", () => {
    const persisted: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("env-3"),
      label: "with-project",
      wsBaseUrl: "ws://host:3773",
      httpBaseUrl: "http://host:3773",
      createdAt: "2026-01-01T00:00:00Z",
      lastConnectedAt: null,
      sshConfig: {
        host: "host",
        user: "root",
        port: 2222,
        projectId: "custom-project-id",
        workspaceRoot: "/opt/code",
      },
    };
    const result = migratePersistedRecord(persisted);
    expect(result.projectId).toBe("custom-project-id");
    expect(result.identityKey).toBe("root@host:2222:/opt/code");
  });

  it("falls back projectId to environmentId when sshConfig is absent", () => {
    const persisted: PersistedSavedEnvironmentRecord = {
      environmentId: EnvironmentId.make("env-fallback"),
      label: "fallback",
      wsBaseUrl: "ws://10.0.0.1:3773",
      httpBaseUrl: "http://10.0.0.1:3773",
      createdAt: "2026-01-01T00:00:00Z",
      lastConnectedAt: null,
    };
    const result = migratePersistedRecord(persisted);
    expect(result.projectId).toBe("env-fallback");
  });
});

describe("toPersistedSavedEnvironmentRecord", () => {
  it("maps SavedRemoteEnvironment to PersistedSavedEnvironmentRecord", () => {
    const identityKey = makeRemoteIdentityKey({
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app",
    });
    const record = {
      identityKey,
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/app",
      label: "devbox",
      createdAt: "2026-01-01T00:00:00Z",
      environmentId: EnvironmentId.make("env-1"),
      wsBaseUrl: "ws://localhost:59955",
      httpBaseUrl: "http://localhost:59955",
      lastConnectedAt: "2026-01-01T00:00:00Z",
      projectId: "proj-1",
    };
    const persisted = toPersistedSavedEnvironmentRecord(record);
    expect(persisted.environmentId).toBe("env-1");
    expect(persisted.label).toBe("devbox");
    expect(persisted.wsBaseUrl).toBe("ws://localhost:59955");
    expect(persisted.httpBaseUrl).toBe("http://localhost:59955");
    expect(persisted.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(persisted.lastConnectedAt).toBe("2026-01-01T00:00:00Z");
    expect(persisted.sshConfig).toEqual({
      host: "devbox",
      user: "james",
      port: 22,
      projectId: "proj-1",
      workspaceRoot: "/home/james/app",
    });
  });

  it("roundtrips through migratePersistedRecord", () => {
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
      lastConnectedAt: null,
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
});
