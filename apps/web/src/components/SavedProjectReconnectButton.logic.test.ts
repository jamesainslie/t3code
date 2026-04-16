import {
  EnvironmentId,
  ProjectId,
  makeRemoteIdentityKey,
  makeSavedProjectKey,
  type SavedRemoteEnvironment,
  type SavedRemoteProject,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { computeSavedProjectReconnectButtonModel } from "./SavedProjectReconnectButton.logic";

const IDENTITY_KEY = makeRemoteIdentityKey({
  host: "devbox.example.com",
  user: "james",
  port: 22,
  workspaceRoot: "/srv/devbox",
});
const PROJECT_ID = ProjectId.make("proj-1");

function makeSavedProject(overrides?: Partial<SavedRemoteProject>): SavedRemoteProject {
  return {
    savedProjectKey: makeSavedProjectKey({
      environmentIdentityKey: IDENTITY_KEY,
      projectId: PROJECT_ID,
    }),
    environmentIdentityKey: IDENTITY_KEY,
    projectId: PROJECT_ID,
    name: "Atlas",
    workspaceRoot: "/srv/devbox/atlas",
    repositoryCanonicalKey: null,
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-04-10T00:00:00.000Z",
    lastSyncedEnvironmentId: null,
    ...overrides,
  };
}

function makeSavedEnvironment(overrides?: Partial<SavedRemoteEnvironment>): SavedRemoteEnvironment {
  return {
    identityKey: IDENTITY_KEY,
    host: "devbox.example.com",
    user: "james",
    port: 22,
    workspaceRoot: "/srv/devbox",
    label: "devbox",
    createdAt: "2026-04-01T00:00:00.000Z",
    environmentId: EnvironmentId.make("env-devbox"),
    wsBaseUrl: "wss://devbox.example.com/",
    httpBaseUrl: "https://devbox.example.com/",
    lastConnectedAt: null,
    projectId: "proj-1",
    ...overrides,
  };
}

describe("computeSavedProjectReconnectButtonModel", () => {
  it("returns project-missing when no saved project is provided", () => {
    const model = computeSavedProjectReconnectButtonModel({
      savedProject: null,
      savedEnvironment: makeSavedEnvironment(),
      busy: false,
    });
    expect(model.state).toBe("project-missing");
    expect(model.disabled).toBe(true);
  });

  it("returns pending when busy, regardless of environment state", () => {
    const model = computeSavedProjectReconnectButtonModel({
      savedProject: makeSavedProject(),
      savedEnvironment: makeSavedEnvironment(),
      busy: true,
    });
    expect(model.state).toBe("pending");
    expect(model.disabled).toBe(true);
    expect(model.label).toBe("Connecting…");
    expect(model.tooltip).toContain("Atlas");
  });

  it("returns parent-missing when the saved environment is absent", () => {
    const model = computeSavedProjectReconnectButtonModel({
      savedProject: makeSavedProject(),
      savedEnvironment: null,
      busy: false,
    });
    expect(model.state).toBe("parent-missing");
    expect(model.disabled).toBe(true);
    expect(model.tooltip).toContain("Re-pair");
  });

  it("returns parent-no-id when the saved environment has no environmentId", () => {
    const model = computeSavedProjectReconnectButtonModel({
      savedProject: makeSavedProject(),
      savedEnvironment: makeSavedEnvironment({
        environmentId: null as unknown as EnvironmentId,
      }),
      busy: false,
    });
    expect(model.state).toBe("parent-no-id");
    expect(model.disabled).toBe(true);
  });

  it("returns idle-reconnect when the project and its environment are fully available", () => {
    const model = computeSavedProjectReconnectButtonModel({
      savedProject: makeSavedProject(),
      savedEnvironment: makeSavedEnvironment(),
      busy: false,
    });
    expect(model.state).toBe("idle-reconnect");
    expect(model.disabled).toBe(false);
    expect(model.label).toBe("Reconnect");
    expect(model.tooltip).toContain("Atlas");
    expect(model.tooltip).toContain("devbox");
  });
});
