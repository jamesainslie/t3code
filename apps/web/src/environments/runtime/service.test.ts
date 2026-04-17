import {
  EnvironmentId,
  ProjectId,
  type LocalApi,
  makeRemoteIdentityKey,
  makeSavedProjectKey,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSavedEnvironmentRegistryStore } from "./catalog";
import {
  resetSavedProjectRegistryStoreForTests,
  useSavedProjectRegistryStore,
} from "./projectsCatalog";
import { reconnectSavedProject, shouldApplyTerminalEvent } from "./service";

describe("shouldApplyTerminalEvent", () => {
  it("applies terminal events for draft-only threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: true,
      }),
    ).toBe(true);
  });

  it("drops terminal events for unknown threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: undefined,
        hasDraftThread: false,
      }),
    ).toBe(false);
  });

  it("drops terminal events for archived server threads even if a draft exists", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: "2026-04-09T00:00:00.000Z",
        hasDraftThread: true,
      }),
    ).toBe(false);
  });

  it("applies terminal events for active server threads", () => {
    expect(
      shouldApplyTerminalEvent({
        serverThreadArchivedAt: null,
        hasDraftThread: false,
      }),
    ).toBe(true);
  });
});

describe("reconnectSavedProject", () => {
  const ENV_KEY = makeRemoteIdentityKey({
    host: "a.example.com",
    user: "james",
    port: 22,
    workspaceRoot: "/srv/a",
  });
  const PROJECT_ID = ProjectId.make("proj-1");
  const SAVED_KEY = makeSavedProjectKey({
    environmentIdentityKey: ENV_KEY,
    projectId: PROJECT_ID,
  });

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
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    useSavedEnvironmentRegistryStore.getState().reset();
    resetSavedProjectRegistryStoreForTests();
    const { __resetLocalApiForTests } = await import("../../localApi");
    await __resetLocalApiForTests();
    vi.unstubAllGlobals();
  });

  it("throws when the saved project is not in the registry", async () => {
    await expect(reconnectSavedProject(SAVED_KEY)).rejects.toThrow(/Saved project not found/);
  });

  it("throws when the parent environment is not in the registry", async () => {
    useSavedProjectRegistryStore.getState().upsertMany([
      {
        savedProjectKey: SAVED_KEY,
        environmentIdentityKey: ENV_KEY,
        projectId: PROJECT_ID,
        name: "Orphan",
        workspaceRoot: "/srv/a/proj-1",
        repositoryCanonicalKey: null,
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        lastSyncedEnvironmentId: null,
      },
    ]);

    await expect(reconnectSavedProject(SAVED_KEY)).rejects.toThrow(
      /Parent saved environment is missing/,
    );
  });

  it("throws when the parent environment has no environmentId", async () => {
    useSavedEnvironmentRegistryStore.getState().upsert({
      identityKey: ENV_KEY,
      host: "a.example.com",
      user: "james",
      port: 22,
      workspaceRoot: "/srv/a",
      label: "Env A",
      createdAt: "2026-04-01T00:00:00.000Z",
      environmentId: null,
      wsBaseUrl: "wss://a.example.com/",
      httpBaseUrl: "https://a.example.com/",
      lastConnectedAt: null,
      projectId: "x",
    });
    useSavedProjectRegistryStore.getState().upsertMany([
      {
        savedProjectKey: SAVED_KEY,
        environmentIdentityKey: ENV_KEY,
        projectId: PROJECT_ID,
        name: "Proj",
        workspaceRoot: "/srv/a/proj-1",
        repositoryCanonicalKey: null,
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-01T00:00:00.000Z",
        lastSyncedEnvironmentId: null,
      },
    ]);

    await expect(reconnectSavedProject(SAVED_KEY)).rejects.toThrow(
      /has no environmentId; cannot reconnect/,
    );
  });
});
