import {
  EnvironmentId,
  makeRemoteIdentityKey,
  type SavedRemoteEnvironment,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { SavedEnvironmentRuntimeState } from "../environments/runtime";
import { computeRemotePillModel } from "./SidebarRemoteReconnectPill.logic";

function makeRemote(overrides: {
  environmentId: string;
  label: string;
  host?: string;
}): SavedRemoteEnvironment & { environmentId: EnvironmentId } {
  const host = overrides.host ?? `${overrides.environmentId}.example.com`;
  return {
    identityKey: makeRemoteIdentityKey({ host, user: "james", port: 22, workspaceRoot: "/w" }),
    host,
    user: "james",
    port: 22,
    workspaceRoot: "/w",
    label: overrides.label,
    createdAt: "2026-04-16T00:00:00Z",
    environmentId: EnvironmentId.make(overrides.environmentId),
    wsBaseUrl: `wss://${host}/`,
    httpBaseUrl: `https://${host}/`,
    lastConnectedAt: null,
    projectId: overrides.environmentId,
  };
}

function makeRuntime(
  partial: Partial<SavedEnvironmentRuntimeState> & {
    connectionState: SavedEnvironmentRuntimeState["connectionState"];
  },
): SavedEnvironmentRuntimeState {
  return {
    connectionState: partial.connectionState,
    authState: "authenticated",
    lastError: null,
    lastErrorAt: null,
    errorCategory: null,
    errorGuidance: null,
    role: null,
    descriptor: null,
    serverConfig: null,
    connectedAt: null,
    disconnectedAt: null,
  };
}

describe("computeRemotePillModel", () => {
  it("hides the pill when no saved remote environments exist", () => {
    expect(computeRemotePillModel({ records: [], runtimeById: {} })).toEqual({
      state: "hidden",
      label: "",
      tooltip: "",
      reconnectTargets: [],
      remoteCount: 0,
    });
  });

  it("hides the pill when only records without environmentId are present", () => {
    const draft = {
      ...makeRemote({ environmentId: "env-1", label: "draft" }),
      environmentId: null as unknown as EnvironmentId,
    };
    expect(computeRemotePillModel({ records: [draft], runtimeById: {} }).state).toBe("hidden");
  });

  it("shows connected state with single env label when one remote is connected", () => {
    const remote = makeRemote({ environmentId: "env-1", label: "devbox" });
    const model = computeRemotePillModel({
      records: [remote],
      runtimeById: { [remote.environmentId]: makeRuntime({ connectionState: "connected" }) },
    });
    expect(model.state).toBe("connected");
    expect(model.label).toBe("devbox");
    expect(model.tooltip).toContain("devbox");
    expect(model.reconnectTargets).toEqual([]);
  });

  it("shows aggregate connected count when multiple remotes are all connected", () => {
    const a = makeRemote({ environmentId: "env-a", label: "alpha" });
    const b = makeRemote({ environmentId: "env-b", label: "beta" });
    const model = computeRemotePillModel({
      records: [a, b],
      runtimeById: {
        [a.environmentId]: makeRuntime({ connectionState: "connected" }),
        [b.environmentId]: makeRuntime({ connectionState: "connected" }),
      },
    });
    expect(model.state).toBe("connected");
    expect(model.label).toBe("Connected (2)");
  });

  it("prefers reconnect over connected when any remote is disconnected", () => {
    const a = makeRemote({ environmentId: "env-a", label: "alpha" });
    const b = makeRemote({ environmentId: "env-b", label: "beta" });
    const model = computeRemotePillModel({
      records: [a, b],
      runtimeById: {
        [a.environmentId]: makeRuntime({ connectionState: "connected" }),
        [b.environmentId]: makeRuntime({ connectionState: "disconnected" }),
      },
    });
    expect(model.state).toBe("reconnect");
    expect(model.reconnectTargets).toEqual([b.environmentId]);
    expect(model.label).toBe("Reconnect (1)");
  });

  it("prefers error over reconnect when any remote is in error state", () => {
    const a = makeRemote({ environmentId: "env-a", label: "alpha" });
    const b = makeRemote({ environmentId: "env-b", label: "beta" });
    const model = computeRemotePillModel({
      records: [a, b],
      runtimeById: {
        [a.environmentId]: makeRuntime({ connectionState: "disconnected" }),
        [b.environmentId]: makeRuntime({ connectionState: "error" }),
      },
    });
    expect(model.state).toBe("error");
    expect(model.reconnectTargets).toEqual([b.environmentId]);
  });

  it("shows connecting when no error/disconnected and at least one is connecting", () => {
    const remote = makeRemote({ environmentId: "env-1", label: "devbox" });
    const model = computeRemotePillModel({
      records: [remote],
      runtimeById: { [remote.environmentId]: makeRuntime({ connectionState: "connecting" }) },
    });
    expect(model.state).toBe("connecting");
    expect(model.reconnectTargets).toEqual([]);
  });

  it("treats missing runtime state as disconnected", () => {
    const remote = makeRemote({ environmentId: "env-1", label: "devbox" });
    const model = computeRemotePillModel({ records: [remote], runtimeById: {} });
    expect(model.state).toBe("reconnect");
    expect(model.reconnectTargets).toEqual([remote.environmentId]);
    expect(model.label).toBe("Reconnect devbox");
  });

  it("uses single-env label when only one remote is disconnected", () => {
    const remote = makeRemote({ environmentId: "env-1", label: "staging" });
    const model = computeRemotePillModel({
      records: [remote],
      runtimeById: { [remote.environmentId]: makeRuntime({ connectionState: "disconnected" }) },
    });
    expect(model.label).toBe("Reconnect staging");
    expect(model.tooltip).toContain("staging");
  });
});
