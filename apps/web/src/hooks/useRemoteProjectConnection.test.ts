import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the broker client
vi.mock("../rpc/brokerClient", () => ({
  connectRemoteProject: vi.fn(),
  disconnectRemoteProject: vi.fn(),
}));

import { connectRemoteProject, disconnectRemoteProject } from "../rpc/brokerClient";
import { useRemoteConnectionStore } from "../remoteConnectionStore";
import { createRemoteConnectionManager } from "./useRemoteProjectConnection";

const mockProject = {
  id: "proj-123" as any,
  remoteHost: { host: "devbox", user: "james", port: 22 },
  workspaceRoot: "/home/james/myapp",
  title: "My App",
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useRemoteConnectionStore.setState({ connections: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRemoteConnectionManager", () => {
  it("does nothing for a local project (no remoteHost)", async () => {
    const localProject = { ...mockProject, remoteHost: undefined };
    const manager = createRemoteConnectionManager(localProject as any);
    await manager.connect();
    expect(connectRemoteProject).not.toHaveBeenCalled();
  });

  it("does nothing when project is null", async () => {
    const manager = createRemoteConnectionManager(null);
    await manager.connect();
    expect(connectRemoteProject).not.toHaveBeenCalled();
  });

  it("calls connectRemoteProject with correct args for a remote project", async () => {
    vi.mocked(connectRemoteProject).mockResolvedValue({ wsUrl: "ws://127.0.0.1:49200" });

    const manager = createRemoteConnectionManager(mockProject as any);
    await manager.connect();

    expect(connectRemoteProject).toHaveBeenCalledWith({
      projectId: "proj-123",
      host: "devbox",
      user: "james",
      port: 22,
      workspaceRoot: "/home/james/myapp",
    });
  });

  it("sets status to connected on success", async () => {
    vi.mocked(connectRemoteProject).mockResolvedValue({ wsUrl: "ws://127.0.0.1:49200" });

    const manager = createRemoteConnectionManager(mockProject as any);
    await manager.connect();

    const status = useRemoteConnectionStore.getState().getStatus("proj-123");
    expect(status).toBe("connected");
  });

  it("sets status to reconnecting after first failure, then error after max retries", async () => {
    vi.mocked(connectRemoteProject).mockRejectedValue(new Error("SSH failed"));

    const manager = createRemoteConnectionManager(mockProject as any, {
      maxRetryDurationMs: 100,
      backoffMs: [10, 20],
    });

    // Start connect and let it fail, then trigger retries
    const connectPromise = manager.connect();

    // Advance timers to allow retries to exhaust the max duration
    await vi.runAllTimersAsync();
    await connectPromise;

    const status = useRemoteConnectionStore.getState().getStatus("proj-123");
    expect(status).toBe("error");
  });

  it("calls disconnectRemoteProject on dispose", async () => {
    vi.mocked(connectRemoteProject).mockResolvedValue({ wsUrl: "ws://127.0.0.1:49200" });

    const manager = createRemoteConnectionManager(mockProject as any);
    await manager.connect();

    manager.dispose();
    expect(disconnectRemoteProject).toHaveBeenCalledWith("proj-123");
  });

  it("does not update store after disposal", async () => {
    // Simulate a slow connect that resolves after disposal
    let resolveConnect!: (v: { wsUrl: string }) => void;
    vi.mocked(connectRemoteProject).mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      }),
    );

    const manager = createRemoteConnectionManager(mockProject as any);
    void manager.connect();

    manager.dispose();
    resolveConnect({ wsUrl: "ws://127.0.0.1:49200" });

    // Give microtasks a chance to run
    await Promise.resolve();

    // Status should not have become "connected" after disposal
    const status = useRemoteConnectionStore.getState().getStatus("proj-123");
    expect(status).not.toBe("connected");
  });
});
