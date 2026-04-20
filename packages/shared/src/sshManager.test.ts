import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ProcessHandle, SshConnectionManager } from "./sshManager.js";

function makeMockProcess(): ProcessHandle {
  const proc = new EventEmitter();
  const killMock = vi.fn(() => true);
  return Object.assign(proc, { kill: killMock }) as unknown as ProcessHandle;
}

describe("SshConnectionManager", () => {
  let spawnMock: (cmd: string, args: string[]) => ProcessHandle;
  let checkMock: (target: { host: string; user: string; port: number }) => Promise<boolean>;
  let manager: SshConnectionManager;

  beforeEach(() => {
    spawnMock = vi.fn().mockReturnValue(makeMockProcess()) as unknown as typeof spawnMock;
    checkMock = vi.fn().mockResolvedValue(false) as unknown as typeof checkMock; // no existing control socket
    manager = new SshConnectionManager({ spawn: spawnMock, checkSocket: checkMock });
  });

  afterEach(() => {
    manager.closeAll();
  });

  describe("getOrCreate", () => {
    it("creates a new master connection when no control socket exists", async () => {
      const target = { host: "devbox", user: "james", port: 22 };
      await manager.getOrCreate(target);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it("returns the same connection for the same target", async () => {
      const target = { host: "devbox", user: "james", port: 22 };
      const c1 = await manager.getOrCreate(target);
      const c2 = await manager.getOrCreate(target);
      expect(c1).toBe(c2);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it("creates separate connections for different hosts", async () => {
      await manager.getOrCreate({ host: "devbox1", user: "james", port: 22 });
      await manager.getOrCreate({ host: "devbox2", user: "james", port: 22 });
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it("attaches to existing control socket without spawning", async () => {
      (checkMock as ReturnType<typeof vi.fn>).mockResolvedValue(true); // existing socket
      await manager.getOrCreate({ host: "devbox", user: "james", port: 22 });
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it("differentiates by port", async () => {
      await manager.getOrCreate({ host: "devbox", user: "james", port: 22 });
      await manager.getOrCreate({ host: "devbox", user: "james", port: 2222 });
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("close", () => {
    it("kills the process and removes the connection", async () => {
      const target = { host: "devbox", user: "james", port: 22 };
      const conn = await manager.getOrCreate(target);
      await manager.close(target);
      if (conn.process) {
        expect(conn.process.kill).toHaveBeenCalled();
      }
      // After close, getOrCreate should spawn a new connection
      await manager.getOrCreate(target);
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it("is a no-op for non-existent connection", async () => {
      await expect(manager.close({ host: "none", user: "x", port: 22 })).resolves.toBeUndefined();
    });
  });

  describe("closeAll", () => {
    it("kills all processes", async () => {
      const proc1 = makeMockProcess();
      const proc2 = makeMockProcess();
      let callCount = 0;
      const spawnSequenced = vi.fn(() => {
        callCount++;
        return callCount === 1 ? proc1 : proc2;
      }) as unknown as typeof spawnMock;
      const m = new SshConnectionManager({ spawn: spawnSequenced, checkSocket: checkMock });
      await m.getOrCreate({ host: "devbox1", user: "james", port: 22 });
      await m.getOrCreate({ host: "devbox2", user: "james", port: 22 });
      m.closeAll();
      expect(proc1.kill).toHaveBeenCalled();
      expect(proc2.kill).toHaveBeenCalled();
    });
  });
});
