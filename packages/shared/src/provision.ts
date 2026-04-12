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
  normalizeVersion,
  parseProbeOutput,
  remoteAuthTokenFile,
  remoteEnvFile,
  remoteServerLogFile,
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
  pairingUrl?: string;
}

export type ProvisionEventType = "phase-start" | "phase-complete" | "log" | "error";

export interface ProvisionEvent {
  type: ProvisionEventType;
  /** Phase number (1-5) */
  phase?: number;
  /** Human-readable label for the phase */
  label?: string;
  /** Detail message (log line, error message) */
  message?: string;
  timestamp: number;
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
  /** Optional callback for real-time remote server log lines */
  onLog?: (line: string) => void;
  /** Optional granular provisioning event callback */
  onProvisionEvent?: (event: ProvisionEvent) => void;
}

export interface ProvisionResult {
  /** The remote port the T3 server is listening on */
  remotePort: number;
  /** The local port the SSH tunnel is forwarding to remotePort */
  localPort: number;
  /** The fresh auth token written to the remote auth-token file */
  authToken: string;
  /** The pairing URL for registering this server as a saved environment */
  pairingUrl?: string | undefined;
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
    const rec = parsed as Record<string, unknown>;
    return {
      port: rec.port as number,
      pid: rec.pid as number,
      ...(typeof rec.pairingUrl === "string" ? { pairingUrl: rec.pairingUrl } : {}),
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
  // Wrap in /bin/sh -c to ensure POSIX shell regardless of remote login shell (e.g., fish)
  const escaped = command.replace(/'/g, "'\\''");
  return [...buildSshArgs(target), `/bin/sh -c '${escaped}'`];
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
  const { target, projectId, workspaceRoot, localVersion, onStatus, onProvisionEvent } = opts;
  const log = (msg: string) => console.log(`[ssh-provision] ${target.user}@${target.host}: ${msg}`);

  const emit = (event: Omit<ProvisionEvent, "timestamp">) => {
    onProvisionEvent?.({ ...event, timestamp: Date.now() });
  };

  onStatus?.("provisioning");

  // Phase 1: Ensure master SSH connection
  log("phase 1: checking SSH control socket...");
  emit({ type: "phase-start", phase: 1, label: "Establishing SSH connection" });
  try {
    await opts.sshManager.getOrCreate(target);
  } catch (err) {
    emit({ type: "error", phase: 1, message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  log("phase 1: SSH master connection ready");
  emit({ type: "log", phase: 1, message: "SSH master connection ready" });
  emit({ type: "phase-complete", phase: 1, label: "Establishing SSH connection" });

  // Phase 2: Probe remote environment and resolve the remote home directory.
  log("phase 2: probing remote environment...");
  emit({ type: "phase-start", phase: 2, label: "Probing remote environment" });
  let probe: ReturnType<typeof parseProbeOutput>;
  let remoteHome: string;
  try {
    const [probeOutput, home] = await Promise.all([
      runSshCommand(target, PROBE_SCRIPT),
      runSshCommand(target, "echo $HOME").then((s) => s.trim()),
    ]);
    probe = parseProbeOutput(probeOutput);
    remoteHome = home;
  } catch (err) {
    emit({ type: "error", phase: 2, message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
  if (!probe) {
    const msg = "Failed to parse remote probe output";
    emit({ type: "error", phase: 2, message: msg });
    throw new Error(msg);
  }
  if (!remoteHome || remoteHome.startsWith("$")) {
    const msg = `Failed to resolve remote home directory: ${JSON.stringify(remoteHome)}`;
    emit({ type: "error", phase: 2, message: msg });
    throw new Error(msg);
  }
  log(`phase 2: ${probe.os}/${probe.arch}, remote version=${probe.currentVersion || "(none)"}, home=${remoteHome}`);
  emit({ type: "log", phase: 2, message: `${probe.os}/${probe.arch}, version ${probe.currentVersion || "(none)"}` });
  emit({ type: "phase-complete", phase: 2, label: "Probing remote environment" });

  const t3Home = `${remoteHome}/.t3`;

  const platform = resolveRemotePlatform(probe.os, probe.arch);
  if (!platform) {
    const msg = `Unsupported remote platform: ${probe.os}/${probe.arch}`;
    emit({ type: "error", phase: 3, message: msg });
    throw new Error(
      `Unsupported remote platform: ${probe.os}/${probe.arch}. Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64`,
    );
  }

  // Phase 3+4: Check for existing tmux session FIRST — if the server is
  // already running, skip binary transfer (the binary is locked by the process
  // and can't be overwritten via SCP anyway).
  onStatus?.("starting");
  log("phase 3: checking for existing tmux session...");
  const tmuxCheckOutput = await runSshCommand(target, buildTmuxCheckCommand(projectId));
  log(`phase 3: tmux check raw output: ${JSON.stringify(tmuxCheckOutput.trim())}`);
  const sessionExists = tmuxCheckOutput.trim() === "exists";

  const remoteNormalized = normalizeVersion(probe.currentVersion);
  const localNormalized = normalizeVersion(localVersion);
  if (!sessionExists && remoteNormalized !== localNormalized) {
    emit({ type: "phase-start", phase: 3, label: "Transferring binaries" });
    log(`phase 3: version mismatch (remote=${remoteNormalized || "none"}, local=${localNormalized}), transferring binaries...`);
    emit({ type: "log", phase: 3, message: `Version mismatch (remote=${remoteNormalized || "none"}, local=${localNormalized})` });
    onStatus?.("provisioning");
    // Kill any orphaned t3 processes that may be holding the binary open
    await runSshCommand(target, `pkill -9 -f 't3 serve' 2>/dev/null || true`).catch(() => {});
    // Small delay to let the process fully exit and release the file
    await sleep(500);
    const serverBin = opts.serverBinaryPath(platform.platform, platform.arch);
    const tmuxBin = opts.tmuxBinaryPath(platform.platform, platform.arch);
    log(`phase 3: uploading server binary: ${serverBin}`);
    emit({ type: "log", phase: 3, message: "Uploading server binary..." });
    try {
      await scpFile(target, serverBin, `${t3Home}/bin/t3`);
      log(`phase 3: uploading tmux binary: ${tmuxBin}`);
      emit({ type: "log", phase: 3, message: "Uploading tmux binary..." });
      await scpFile(target, tmuxBin, `${t3Home}/bin/tmux`);
      await runSshCommand(target, `chmod +x ${t3Home}/bin/t3 ${t3Home}/bin/tmux`);
    } catch (err) {
      emit({ type: "error", phase: 3, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    log("phase 3: binaries installed and marked executable");
    emit({ type: "log", phase: 3, message: "Binaries installed" });
    emit({ type: "phase-complete", phase: 3, label: "Transferring binaries" });
  } else if (sessionExists) {
    emit({ type: "phase-start", phase: 3, label: "Binaries up to date" });
    log("phase 3: tmux session exists, skipping binary transfer (server is running)");
    emit({ type: "log", phase: 3, message: "Server already running, skipping transfer" });
    emit({ type: "phase-complete", phase: 3, label: "Binaries up to date" });
  } else {
    emit({ type: "phase-start", phase: 3, label: "Binaries up to date" });
    log(`phase 3: version match (${localNormalized}), skipping binary transfer`);
    emit({ type: "log", phase: 3, message: `Version match (${localNormalized})` });
    emit({ type: "phase-complete", phase: 3, label: "Binaries up to date" });
  }

  let remotePort: number;
  let pairingUrl: string | undefined;

  if (sessionExists) {
    emit({ type: "phase-start", phase: 4, label: "Reconnecting to server" });
    log("phase 4: tmux session exists, reading state file...");
    const stateJson = await runSshCommand(
      target,
      `cat ${remoteServerStateFile(projectId)} 2>/dev/null || echo ""`,
    );
    const state = parseServerStateFile(stateJson.trim());
    if (!state) {
      log("phase 4: state file missing/corrupt, killing stale session and cold-starting...");
      emit({ type: "log", phase: 4, message: "State file corrupt, restarting server..." });
      await runSshCommand(target, buildTmuxKillCommand(projectId));
      try {
        remotePort = await coldStart(target, projectId, workspaceRoot, opts.onLog);
      } catch (err) {
        emit({ type: "error", phase: 4, message: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    } else {
      remotePort = state.port;
      pairingUrl = state.pairingUrl;
      log(`phase 4: reconnected to existing server on remote port ${remotePort}`);
      emit({ type: "log", phase: 4, message: `Reconnected on port ${remotePort}` });
    }
    emit({ type: "phase-complete", phase: 4, label: "Reconnecting to server" });
  } else {
    emit({ type: "phase-start", phase: 4, label: "Starting remote server" });
    log("phase 4: no tmux session, cold-starting server...");
    try {
      remotePort = await coldStart(target, projectId, workspaceRoot, opts.onLog);
    } catch (err) {
      emit({ type: "error", phase: 4, message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    log(`phase 4: server started on remote port ${remotePort}`);
    emit({ type: "log", phase: 4, message: `Server started on port ${remotePort}` });
    emit({ type: "phase-complete", phase: 4, label: "Starting remote server" });
  }

  // Extract the pairing URL from the server's stdout log. The state file may
  // contain a stale credential (issued at write time, potentially consumed by
  // the server's own startup). The stdout log contains the live pairing URL
  // printed after startup: "Pairing URL: http://127.0.0.1:3773/pair#token=XXXX"
  if (!pairingUrl) {
    const logContent = await runSshCommand(
      target,
      `cat ${remoteServerLogFile(projectId)} 2>/dev/null || echo ""`,
    );
    const pairingMatch = logContent.match(/Pairing URL:\s*(http\S+)/);
    if (pairingMatch) {
      pairingUrl = pairingMatch[1];
      log(`extracted pairing URL from server log`);
    } else {
      // Fall back to state file
      const stateJson = await runSshCommand(
        target,
        `cat ${remoteServerStateFile(projectId)} 2>/dev/null || echo ""`,
      );
      const state = parseServerStateFile(stateJson.trim());
      pairingUrl = state?.pairingUrl;
      if (pairingUrl) {
        log("using pairing URL from state file (fallback)");
      }
    }
  }

  // Write fresh auth token
  const authToken = generateToken();
  await writeRemoteFile(target, remoteAuthTokenFile(projectId), authToken);

  // Write current SSH_AUTH_SOCK to env file
  const sshAuthSock = process.env.SSH_AUTH_SOCK;
  if (sshAuthSock) {
    await writeRemoteFile(target, remoteEnvFile(projectId), `SSH_AUTH_SOCK=${sshAuthSock}`);
  }

  // Phase 5: Set up SSH port forward
  log("phase 5: setting up port forward...");
  emit({ type: "phase-start", phase: 5, label: "Setting up secure tunnel" });
  let localPort: number;
  try {
    localPort = await findFreeLocalPort();
    await setupPortForward(target, localPort, remotePort);
    log(`phase 5: tunnel established — localhost:${localPort} → remote:${remotePort}`);
    emit({ type: "log", phase: 5, message: `Tunnel: localhost:${localPort} → remote:${remotePort}` });
    emit({ type: "phase-complete", phase: 5, label: "Setting up secure tunnel" });
  } catch (err) {
    emit({ type: "error", phase: 5, message: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  if (pairingUrl) {
    log(`provisioning complete — pairing URL available`);
  } else {
    log("provisioning complete — WARNING: no pairing URL in state file (server may be too old)");
  }

  onStatus?.("connected");

  return { remotePort, localPort, authToken, pairingUrl };
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
  onLog?: (line: string) => void,
): Promise<number> {
  // Write initial auth token placeholder so server can start
  const initialToken = generateToken();
  await runSshCommand(target, `mkdir -p $HOME/.t3/run/${projectId}/logs`);
  await writeRemoteFile(target, remoteAuthTokenFile(projectId), initialToken);

  // Touch the log file so tail -f doesn't fail on missing file
  await runSshCommand(target, `touch ${remoteServerLogFile(projectId)}`);

  // Start tailing the remote log BEFORE starting the server so we capture
  // everything including early startup errors
  const logTailer = onLog ? startRemoteLogTail(target, projectId, onLog) : null;

  // Start tmux session
  await runSshCommand(target, buildTmuxStartCommand(projectId, workspaceRoot));

  // Poll for state file
  try {
    return await waitForStateFile(target, projectId);
  } catch (err) {
    // On timeout, read the server log to include in the error message
    const remoteLog = await readRemoteLog(target, projectId);
    const logSnippet = remoteLog
      ? `\n\nRemote server log (last 50 lines):\n${remoteLog}`
      : "\n\n(No remote server log available)";
    throw new Error(
      `Timed out waiting for remote T3 server to start (projectId=${projectId})${logSnippet}`,
    );
  } finally {
    logTailer?.kill();
  }
}

/**
 * Start streaming remote server log via SSH `tail -f`. Returns a handle
 * to kill the tail process when no longer needed.
 */
function startRemoteLogTail(
  target: SshTarget,
  projectId: string,
  onLine: (line: string) => void,
): { kill: () => void } {
  const logFile = remoteServerLogFile(projectId);
  const args = buildSshCommand(target, `tail -f ${logFile}`);
  const proc = nodeSpawn("ssh", args, { stdio: ["ignore", "pipe", "ignore"] });

  let buffer = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  });

  return {
    kill: () => {
      try {
        proc.kill("SIGTERM");
      } catch {
        // already dead
      }
    },
  };
}

/**
 * Read the last 50 lines of the remote server log. Used for error diagnostics.
 */
async function readRemoteLog(target: SshTarget, projectId: string): Promise<string | null> {
  try {
    const logFile = remoteServerLogFile(projectId);
    const output = await runSshCommand(target, `tail -50 ${logFile} 2>/dev/null`);
    return output.trim() || null;
  } catch {
    return null;
  }
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
  // Don't throw here — caller handles the error with log reading
  throw new Error("state file not found");
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
  // Wrap in /bin/sh -c to ensure POSIX shell regardless of remote login shell (e.g., fish)
  const args = [...buildSshArgs(target), `/bin/sh -c 'cat > ${remotePath}'`];
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
  // 10 minutes — server binary is ~102MB, can be slow over VPN
  await execFileAsync("scp", args, { timeout: 600_000 });
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
