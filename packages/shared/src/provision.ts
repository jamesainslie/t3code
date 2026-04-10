/**
 * Remote provisioner — orchestrates the full SSH connection lifecycle.
 *
 * Phases:
 * 1. Ensure SSH master connection (via SshConnectionManager)
 * 2. Probe remote OS/arch/version
 * 3. Transfer binaries if version mismatch
 * 4. Start/resume tmux session with T3 server
 * 5. Set up SSH port forward
 *
 * @module provision
 */
import { execFile, spawn as nodeSpawn } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

import {
  PROBE_SCRIPT,
  buildPortForwardArgs,
  buildCancelForwardArgs,
  buildSshArgs,
  buildTmuxCheckCommand,
  buildTmuxKillCommand,
  buildTmuxStartCommand,
  controlSocketPath,
  parseProbeOutput,
  remoteAuthTokenFile,
  remoteEnvFile,
  remoteServerStateFile,
  resolveRemotePlatform,
  type SshTarget,
} from "./ssh.js";
import { SshConnectionManager } from "./sshManager.js";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────

export interface ServerState {
  port: number;
  pid: number;
}

export interface ProvisionOptions {
  target: SshTarget;
  projectId: string;
  workspaceRoot: string;
  /** Local app version — remote binary must match */
  localVersion: string;
  /** Returns the local path to the server binary for the given platform/arch */
  serverBinaryPath: (platform: string, arch: string) => string;
  /** Returns the local path to the tmux binary for the given platform/arch */
  tmuxBinaryPath: (platform: string, arch: string) => string;
  sshManager: SshConnectionManager;
  /** Optional progress callback */
  onStatus?: (phase: "provisioning" | "starting" | "connected") => void;
}

export interface ProvisionResult {
  /** The remote port the T3 server is listening on */
  remotePort: number;
  /** The local port the SSH tunnel is forwarding to remotePort */
  localPort: number;
  /** The fresh auth token written to the remote auth-token file */
  authToken: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────

export function parseServerStateFile(json: string): ServerState | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).port !== "number" ||
      typeof (parsed as Record<string, unknown>).pid !== "number"
    ) {
      return null;
    }
    return {
      port: (parsed as Record<string, unknown>).port as number,
      pid: (parsed as Record<string, unknown>).pid as number,
    };
  } catch {
    return null;
  }
}

/**
 * Build the argv array for running a command over SSH.
 * Exported for testability.
 */
export function buildSshCommand(target: SshTarget, command: string): string[] {
  return [...buildSshArgs(target), command];
}

/**
 * Build the shell command string that starts the T3 server in a tmux session.
 * Delegates to buildTmuxStartCommand from shared/ssh.
 * Exported for testability.
 */
export function buildStartServerCommand(projectId: string, workspaceRoot: string): string {
  return buildTmuxStartCommand(projectId, workspaceRoot);
}

// ── Provisioner ───────────────────────────────────────────────────────

export async function provision(opts: ProvisionOptions): Promise<ProvisionResult> {
  const { target, projectId, workspaceRoot, localVersion, onStatus } = opts;

  onStatus?.("provisioning");

  // Phase 1: Ensure master SSH connection
  await opts.sshManager.getOrCreate(target);

  // Phase 2: Probe remote environment
  const probeOutput = await runSshCommand(target, PROBE_SCRIPT);
  const probe = parseProbeOutput(probeOutput);
  if (!probe) {
    throw new Error(`Failed to parse remote probe output: ${JSON.stringify(probeOutput)}`);
  }

  const platform = resolveRemotePlatform(probe.os, probe.arch);
  if (!platform) {
    throw new Error(
      `Unsupported remote platform: ${probe.os}/${probe.arch}. Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64`,
    );
  }

  // Phase 3: Transfer binaries if version mismatch
  if (probe.currentVersion !== localVersion) {
    onStatus?.("provisioning");
    const serverBin = opts.serverBinaryPath(platform.platform, platform.arch);
    const tmuxBin = opts.tmuxBinaryPath(platform.platform, platform.arch);
    await scpFile(target, serverBin, "$HOME/.t3/bin/t3");
    await scpFile(target, tmuxBin, "$HOME/.t3/bin/tmux");
    await runSshCommand(target, "chmod +x $HOME/.t3/bin/t3 $HOME/.t3/bin/tmux");
  }

  // Phase 4: Start/resume remote tmux session
  onStatus?.("starting");
  const tmuxCheckOutput = await runSshCommand(target, buildTmuxCheckCommand(projectId));
  const sessionExists = tmuxCheckOutput.trim() === "exists";

  let remotePort: number;

  if (sessionExists) {
    // Fast path: server already running — read its port
    const stateJson = await runSshCommand(
      target,
      `cat ${remoteServerStateFile(projectId)} 2>/dev/null || echo ""`,
    );
    const state = parseServerStateFile(stateJson.trim());
    if (!state) {
      // State file missing/corrupt — kill the stale session and cold-start
      await runSshCommand(target, buildTmuxKillCommand(projectId));
      remotePort = await coldStart(target, projectId, workspaceRoot);
    } else {
      remotePort = state.port;
    }
  } else {
    remotePort = await coldStart(target, projectId, workspaceRoot);
  }

  // Write fresh auth token via stdin to avoid exposing it in process args or shell history
  const authToken = generateToken();
  await writeRemoteFile(target, remoteAuthTokenFile(projectId), authToken);

  // Write current SSH_AUTH_SOCK to env file (for tmux session refresh)
  const sshAuthSock = process.env.SSH_AUTH_SOCK;
  if (sshAuthSock) {
    await writeRemoteFile(target, remoteEnvFile(projectId), `SSH_AUTH_SOCK=${sshAuthSock}`);
  }

  // Phase 5: Set up SSH port forward
  const localPort = await findFreeLocalPort();
  await setupPortForward(target, localPort, remotePort);

  onStatus?.("connected");

  return { remotePort, localPort, authToken };
}

export async function teardown(opts: {
  target: SshTarget;
  projectId: string;
  localPort: number;
}): Promise<void> {
  // Cancel port forward
  await cancelPortForward(
    opts.target,
    opts.localPort,
    await getRemotePort(opts.target, opts.projectId),
  ).catch(() => {});
  // Kill tmux session and clean up run dir
  await runSshCommand(opts.target, buildTmuxKillCommand(opts.projectId)).catch(() => {});
  await runSshCommand(opts.target, `rm -rf $HOME/.t3/run/${opts.projectId}`).catch(() => {});
}

// ── Private helpers ───────────────────────────────────────────────────

async function coldStart(
  target: SshTarget,
  projectId: string,
  workspaceRoot: string,
): Promise<number> {
  // Write initial auth token placeholder so server can start
  const initialToken = generateToken();
  await runSshCommand(target, `mkdir -p $HOME/.t3/run/${projectId}/logs`);
  await writeRemoteFile(target, remoteAuthTokenFile(projectId), initialToken);
  // Start tmux session
  await runSshCommand(target, buildTmuxStartCommand(projectId, workspaceRoot));
  // Poll for state file
  return waitForStateFile(target, projectId);
}

async function waitForStateFile(
  target: SshTarget,
  projectId: string,
  timeoutMs = 15_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const json = await runSshCommand(
        target,
        `cat ${remoteServerStateFile(projectId)} 2>/dev/null || echo ""`,
      );
      const state = parseServerStateFile(json.trim());
      if (state) return state.port;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for remote T3 server to start (projectId=${projectId})`);
}

async function getRemotePort(target: SshTarget, projectId: string): Promise<number> {
  const json = await runSshCommand(
    target,
    `cat ${remoteServerStateFile(projectId)} 2>/dev/null || echo ""`,
  );
  const state = parseServerStateFile(json.trim());
  return state?.port ?? 0;
}

async function runSshCommand(target: SshTarget, command: string): Promise<string> {
  const args = buildSshCommand(target, command);
  const { stdout } = await execFileAsync("ssh", args, { timeout: 30_000 });
  return stdout;
}

async function writeRemoteFile(
  target: SshTarget,
  remotePath: string,
  content: string,
): Promise<void> {
  // Pipe content via stdin to avoid exposing it in process args or shell history
  const args = [...buildSshArgs(target), `cat > ${remotePath}`];
  await new Promise<void>((resolve, reject) => {
    const proc = nodeSpawn("ssh", args, { stdio: ["pipe", "ignore", "pipe"] });
    const errors: string[] = [];
    proc.stderr?.on("data", (d: Buffer) => errors.push(d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`writeRemoteFile failed (exit ${code}): ${errors.join("")}`));
    });
    proc.stdin?.end(content, "utf8");
  });
}

async function scpFile(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
  const controlPath = controlSocketPath(target);
  const args = [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    ...(target.port !== 22 ? ["-P", String(target.port)] : []),
    localPath,
    `${target.user}@${target.host}:${remotePath}`,
  ];
  await execFileAsync("scp", args, { timeout: 120_000 });
}

async function setupPortForward(
  target: SshTarget,
  localPort: number,
  remotePort: number,
): Promise<void> {
  const args = buildPortForwardArgs({ ...target, localPort, remotePort });
  await execFileAsync("ssh", args, { timeout: 10_000 });
}

async function cancelPortForward(
  target: SshTarget,
  localPort: number,
  remotePort: number,
): Promise<void> {
  const args = buildCancelForwardArgs({ ...target, localPort, remotePort });
  await execFileAsync("ssh", args, { timeout: 5_000 }).catch(() => {});
}

async function findFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("Could not find a free local port"));
      });
    });
  });
}

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
