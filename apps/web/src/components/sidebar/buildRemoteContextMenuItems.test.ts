import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, type RemoteIdentityKey } from "@t3tools/contracts";

vi.mock("../../environments/runtime", () => ({
  connectSavedEnvironment: vi.fn(),
  disconnectSavedEnvironment: vi.fn(),
  removeSavedEnvironment: vi.fn(),
}));

vi.mock("../ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

import {
  connectSavedEnvironment,
  disconnectSavedEnvironment,
  removeSavedEnvironment,
} from "../../environments/runtime";
import { toastManager } from "../ui/toast";
import {
  buildRemoteContextMenuItems,
  type BuildRemoteContextMenuItemsInput,
} from "./buildRemoteContextMenuItems";

const envA = EnvironmentId.make("env-a");
const identityA = "identity-a" as unknown as RemoteIdentityKey;

function makeInput(
  overrides: Partial<BuildRemoteContextMenuItemsInput> = {},
  projectOverrides: Partial<BuildRemoteContextMenuItemsInput["project"]> = {},
): BuildRemoteContextMenuItemsInput {
  const confirm = vi.fn<(msg: string) => Promise<boolean>>().mockResolvedValue(true);
  return {
    project: {
      environmentId: envA,
      name: "Demo Project",
      remoteEnvironmentLabels: ["prod-host"] as readonly string[],
      ...projectOverrides,
    },
    remoteIdentityKey: identityA,
    remoteConnectionState: "disconnected",
    api: {
      dialogs: {
        confirm,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildRemoteContextMenuItems", () => {
  it("returns empty items when remoteIdentityKey is null (non-remote project)", () => {
    const { items, actionHandlers } = buildRemoteContextMenuItems(
      makeInput({ remoteIdentityKey: null, remoteConnectionState: "disconnected" }),
    );
    expect(items).toEqual([]);
    expect(actionHandlers.size).toBe(0);
  });

  it("disconnected → emits Reconnect + Remove remote, NOT Disconnect", () => {
    const { items } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "disconnected" }),
    );
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["reconnect", "remove-remote"]);
  });

  it("error state → emits Reconnect + Remove remote, NOT Disconnect", () => {
    const { items } = buildRemoteContextMenuItems(makeInput({ remoteConnectionState: "error" }));
    expect(items.map((i) => i.id)).toEqual(["reconnect", "remove-remote"]);
  });

  it("connected → emits Disconnect + Remove remote, NOT Reconnect", () => {
    const { items } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }),
    );
    expect(items.map((i) => i.id)).toEqual(["disconnect", "remove-remote"]);
  });

  it("connecting → emits Disconnect + Remove remote, NOT Reconnect", () => {
    const { items } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connecting" }),
    );
    expect(items.map((i) => i.id)).toEqual(["disconnect", "remove-remote"]);
  });

  it("envLabel present → labels use 'Reconnect to X' / 'Disconnect from X'", () => {
    const disconnected = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "disconnected" }),
    );
    expect(disconnected.items[0]!.label).toBe("Reconnect to prod-host");

    const connected = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }),
    );
    expect(connected.items[0]!.label).toBe("Disconnect from prod-host");
  });

  it("envLabel absent → labels fall back to 'Reconnect' / 'Disconnect'", () => {
    const disconnected = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "disconnected" }, { remoteEnvironmentLabels: [] }),
    );
    expect(disconnected.items[0]!.label).toBe("Reconnect");

    const connected = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }, { remoteEnvironmentLabels: [] }),
    );
    expect(connected.items[0]!.label).toBe("Disconnect");
  });

  it("remove-remote item is destructive", () => {
    const { items } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }),
    );
    const remove = items.find((i) => i.id === "remove-remote")!;
    expect(remove.destructive).toBe(true);
  });

  it("reconnect handler calls connectSavedEnvironment with identityKey", async () => {
    vi.mocked(connectSavedEnvironment).mockResolvedValueOnce(undefined as never);
    const { actionHandlers } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "disconnected" }),
    );
    await actionHandlers.get("reconnect")!();
    // allow microtasks to flush
    await Promise.resolve();
    expect(connectSavedEnvironment).toHaveBeenCalledWith(identityA);
  });

  it("disconnect handler calls disconnectSavedEnvironment with environmentId", async () => {
    vi.mocked(disconnectSavedEnvironment).mockResolvedValueOnce(undefined as never);
    const { actionHandlers } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }),
    );
    await actionHandlers.get("disconnect")!();
    await Promise.resolve();
    expect(disconnectSavedEnvironment).toHaveBeenCalledWith(envA);
  });

  it("remove-remote handler calls api.dialogs.confirm; bails when declined", async () => {
    const confirm = vi.fn<(msg: string) => Promise<boolean>>().mockResolvedValue(false);
    const input = makeInput({
      remoteConnectionState: "connected",
      api: { dialogs: { confirm } },
    });
    const { actionHandlers } = buildRemoteContextMenuItems(input);
    await actionHandlers.get("remove-remote")!();
    expect(confirm).toHaveBeenCalledWith(
      'Remove remote connection for "Demo Project"? This will not delete the project data on the remote host.',
    );
    expect(removeSavedEnvironment).not.toHaveBeenCalled();
  });

  it("remove-remote handler calls removeSavedEnvironment when confirmed", async () => {
    vi.mocked(removeSavedEnvironment).mockResolvedValueOnce(undefined as never);
    const confirm = vi.fn<(msg: string) => Promise<boolean>>().mockResolvedValue(true);
    const input = makeInput({
      remoteConnectionState: "connected",
      api: { dialogs: { confirm } },
    });
    const { actionHandlers } = buildRemoteContextMenuItems(input);
    await actionHandlers.get("remove-remote")!();
    await Promise.resolve();
    expect(removeSavedEnvironment).toHaveBeenCalledWith(envA);
  });

  it("reconnect handler rejection emits toast with 'Failed to reconnect'", async () => {
    vi.mocked(connectSavedEnvironment).mockRejectedValueOnce(new Error("conn-fail"));
    const { actionHandlers } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "disconnected" }),
    );
    await actionHandlers.get("reconnect")!();
    // flush promise chain
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Failed to reconnect",
      description: "conn-fail",
    });
  });

  it("disconnect handler rejection emits toast with 'Failed to disconnect'", async () => {
    vi.mocked(disconnectSavedEnvironment).mockRejectedValueOnce(new Error("disc-fail"));
    const { actionHandlers } = buildRemoteContextMenuItems(
      makeInput({ remoteConnectionState: "connected" }),
    );
    await actionHandlers.get("disconnect")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Failed to disconnect",
      description: "disc-fail",
    });
  });

  it("remove-remote handler rejection emits toast with 'Failed to remove remote'", async () => {
    vi.mocked(removeSavedEnvironment).mockRejectedValueOnce(new Error("remove-fail"));
    const confirm = vi.fn<(msg: string) => Promise<boolean>>().mockResolvedValue(true);
    const { actionHandlers } = buildRemoteContextMenuItems(
      makeInput({
        remoteConnectionState: "connected",
        api: { dialogs: { confirm } },
      }),
    );
    await actionHandlers.get("remove-remote")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Failed to remove remote",
      description: "remove-fail",
    });
  });
});
