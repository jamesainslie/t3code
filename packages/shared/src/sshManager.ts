/**
 * SshConnectionManager — manages SSH master connections per host.
 *
 * Uses SSH ControlMaster multiplexing to share a single TCP connection
 * across multiple operations to the same host. Checks for existing
 * control sockets before creating new master connections.
 *
 * @module sshManager
 */
import { spawn as nodeSpawn } from "node:child_process";
import { buildCheckSocketArgs, buildSshArgs, type SshTarget } from "./ssh.ts";

/** Minimal interface for a spawned process — allows mocking in tests. */
export interface ProcessHandle {
  kill(signal?: NodeJS.Signals | number): boolean | void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

type SpawnFn = (cmd: string, args: string[]) => ProcessHandle;
type CheckSocketFn = (target: SshTarget) => Promise<boolean>;

export interface ManagedConnection {
  readonly target: SshTarget;
  /** null when attached to an existing control socket (no new process spawned) */
  readonly process: ProcessHandle | null;
  readonly socketExisted: boolean;
}

export interface SshConnectionManagerOptions {
  spawn?: SpawnFn;
  checkSocket?: CheckSocketFn;
}

function defaultCheckSocket(target: SshTarget): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = nodeSpawn("ssh", buildCheckSocketArgs(target), { stdio: "ignore" });
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

export class SshConnectionManager {
  private readonly connections = new Map<string, ManagedConnection>();
  private readonly spawnFn: SpawnFn;
  private readonly checkSocketFn: CheckSocketFn;

  constructor(opts: SshConnectionManagerOptions = {}) {
    this.spawnFn = opts.spawn ?? ((cmd, args) => nodeSpawn(cmd, args, { stdio: "ignore" }));
    this.checkSocketFn = opts.checkSocket ?? defaultCheckSocket;
  }

  private connectionKey(target: SshTarget): string {
    return `${target.user}@${target.host}:${target.port}`;
  }

  async getOrCreate(target: SshTarget): Promise<ManagedConnection> {
    const key = this.connectionKey(target);
    const existing = this.connections.get(key);
    if (existing) return existing;

    // Check for existing control socket (user may already have a session open)
    const socketExisted = await this.checkSocketFn(target);

    let conn: ManagedConnection;

    if (socketExisted) {
      // Attach to existing master — no new process needed
      conn = { target, process: null, socketExisted: true };
    } else {
      // Spawn a new SSH master connection in the background
      const proc = this.spawnFn("ssh", buildSshArgs(target, ["-N", "-f"]));
      conn = { target, process: proc, socketExisted: false };
    }

    this.connections.set(key, conn);
    return conn;
  }

  async close(target: SshTarget): Promise<void> {
    const key = this.connectionKey(target);
    const conn = this.connections.get(key);
    if (!conn) return;
    conn.process?.kill("SIGTERM");
    this.connections.delete(key);
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.process?.kill("SIGTERM");
    }
    this.connections.clear();
  }
}
