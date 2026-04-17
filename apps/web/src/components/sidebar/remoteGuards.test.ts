import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, type RemoteIdentityKey } from "@t3tools/contracts";

const runtimeState: {
  byId: Record<string, { connectionState: string | null } | undefined>;
} = {
  byId: {},
};

const registryState: {
  identityKeyByEnvironmentId: Record<string, string | undefined>;
} = {
  identityKeyByEnvironmentId: {},
};

vi.mock("../../environments/runtime", () => ({
  useSavedEnvironmentRuntimeStore: {
    getState: () => runtimeState,
  },
  useSavedEnvironmentRegistryStore: {
    getState: () => registryState,
  },
  connectSavedEnvironment: vi.fn(),
}));

vi.mock("../ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

import { connectSavedEnvironment } from "../../environments/runtime";
import { toastManager } from "../ui/toast";
import { ensureRemoteConnected } from "./remoteGuards";

const envA = EnvironmentId.make("env-a");
const identityA = "identity-a" as unknown as RemoteIdentityKey;

beforeEach(() => {
  vi.clearAllMocks();
  runtimeState.byId = {};
  registryState.identityKeyByEnvironmentId = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureRemoteConnected", () => {
  it("returns true immediately when runtime state is already connected", async () => {
    runtimeState.byId[envA] = { connectionState: "connected" };
    registryState.identityKeyByEnvironmentId[envA] = identityA;

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(true);
    expect(connectSavedEnvironment).not.toHaveBeenCalled();
    expect(toastManager.add).not.toHaveBeenCalled();
  });

  it("returns true immediately when runtime state is null (no entry)", async () => {
    // No entry in byId, no identity key either.
    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(true);
    expect(connectSavedEnvironment).not.toHaveBeenCalled();
  });

  it("returns true and does NOT call connect when identity key is missing", async () => {
    runtimeState.byId[envA] = { connectionState: "disconnected" };
    // identityKeyByEnvironmentId is empty for envA.

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(true);
    expect(connectSavedEnvironment).not.toHaveBeenCalled();
    expect(toastManager.add).not.toHaveBeenCalled();
  });

  it("calls connectSavedEnvironment with identity key when state is disconnected and returns true on success", async () => {
    runtimeState.byId[envA] = { connectionState: "disconnected" };
    registryState.identityKeyByEnvironmentId[envA] = identityA;
    vi.mocked(connectSavedEnvironment).mockResolvedValueOnce(undefined as never);

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(true);
    expect(connectSavedEnvironment).toHaveBeenCalledWith(identityA);
    expect(toastManager.add).not.toHaveBeenCalled();
  });

  it("calls connectSavedEnvironment when state is error", async () => {
    runtimeState.byId[envA] = { connectionState: "error" };
    registryState.identityKeyByEnvironmentId[envA] = identityA;
    vi.mocked(connectSavedEnvironment).mockResolvedValueOnce(undefined as never);

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(true);
    expect(connectSavedEnvironment).toHaveBeenCalledWith(identityA);
  });

  it("returns false and emits toast when connectSavedEnvironment rejects", async () => {
    runtimeState.byId[envA] = { connectionState: "disconnected" };
    registryState.identityKeyByEnvironmentId[envA] = identityA;
    vi.mocked(connectSavedEnvironment).mockRejectedValueOnce(new Error("boom"));

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(false);
    expect(toastManager.add).toHaveBeenCalledTimes(1);
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Failed to reconnect",
      description: "boom",
    });
  });

  it("uses fallback description for non-Error rejection", async () => {
    runtimeState.byId[envA] = { connectionState: "error" };
    registryState.identityKeyByEnvironmentId[envA] = identityA;
    vi.mocked(connectSavedEnvironment).mockRejectedValueOnce("nope");

    const result = await ensureRemoteConnected(envA);

    expect(result).toBe(false);
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Failed to reconnect",
      description: "An error occurred.",
    });
  });
});
