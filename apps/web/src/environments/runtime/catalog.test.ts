import {
  EnvironmentId,
  type LocalApi,
  type PersistedSavedEnvironmentRecord,
  type RemoteIdentityKey,
} from "@t3tools/contracts";
import { makeRemoteIdentityKey } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetSavedEnvironmentRegistryStoreForTests,
  resetSavedEnvironmentRuntimeStoreForTests,
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
