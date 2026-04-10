/**
 * SSH utilities for remote server management.
 *
 * Pure helper functions for building SSH arguments, parsing probe output,
 * and computing remote file paths. No subprocess execution — callers
 * (desktop main process or broker) handle actual process spawning.
 *
 * @module ssh
 */
import * as OS from "node:os";
import * as Path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────

export interface SshTarget {
  host: string;
  user: string;
  port: number;
}

export interface ProbeResult {
  os: string;
  arch: string;
  currentVersion: string;
}

export interface PortForwardSpec extends SshTarget {
  localPort: number;
  remotePort: number;
}

// ── Control socket path ───────────────────────────────────────────────

export function controlSocketPath(target: SshTarget): string {
  const socketDir = Path.join(OS.homedir(), ".ssh", "sockets");
  return Path.join(socketDir, `${target.user}@${target.host}-${target.port}`);
}

// ── SSH argument builders ─────────────────────────────────────────────

const BASE_SSH_OPTIONS: string[] = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "ControlMaster=auto",
  "-o",
  "ControlPersist=4h",
];

export function buildSshArgs(target: SshTarget, extraArgs: string[] = []): string[] {
  const controlPath = controlSocketPath(target);
  const args: string[] = [...BASE_SSH_OPTIONS, "-o", `ControlPath=${controlPath}`];
  if (target.port !== 22) {
    args.push("-p", String(target.port));
  }
  args.push(...extraArgs);
  args.push(`${target.user}@${target.host}`);
  return args;
}

export function buildCheckSocketArgs(target: SshTarget): string[] {
  const controlPath = controlSocketPath(target);
  return ["-o", `ControlPath=${controlPath}`, "-O", "check", `${target.user}@${target.host}`];
}

export function buildPortForwardArgs(spec: PortForwardSpec): string[] {
  return buildSshArgs(spec, [
    "-O",
    "forward",
    "-L",
    `${spec.localPort}:127.0.0.1:${spec.remotePort}`,
    "-N",
  ]);
}

export function buildCancelForwardArgs(spec: PortForwardSpec): string[] {
  return buildSshArgs(spec, [
    "-O",
    "cancel",
    "-L",
    `${spec.localPort}:127.0.0.1:${spec.remotePort}`,
  ]);
}

// ── Remote probe script ───────────────────────────────────────────────

export const PROBE_SCRIPT = `#!/bin/sh
T3_HOME="$HOME/.t3"
mkdir -p "$T3_HOME/bin" "$T3_HOME/run" "$T3_HOME/logs"
CURRENT_VERSION=""
if [ -x "$T3_HOME/bin/t3" ]; then
  CURRENT_VERSION=$("$T3_HOME/bin/t3" --version 2>/dev/null || echo "")
fi
echo "OS:$(uname -s) ARCH:$(uname -m) VERSION:$CURRENT_VERSION"
`;

export function parseProbeOutput(output: string): ProbeResult | null {
  const match = output.trim().match(/^OS:(\S+)\s+ARCH:(\S+)\s+VERSION:(\S*)$/);
  if (!match) return null;
  return {
    os: match[1]!,
    arch: match[2]!,
    currentVersion: match[3]!,
  };
}

// ── Platform/arch resolution ──────────────────────────────────────────

const OS_MAP: Record<string, string> = {
  Linux: "linux",
  Darwin: "darwin",
};

const ARCH_MAP: Record<string, string> = {
  x86_64: "x64",
  aarch64: "arm64",
  arm64: "arm64",
};

export function resolveRemotePlatform(
  os: string,
  arch: string,
): { platform: string; arch: string } | null {
  const platform = OS_MAP[os];
  const resolvedArch = ARCH_MAP[arch];
  if (!platform || !resolvedArch) return null;
  return { platform, arch: resolvedArch };
}

// ── Remote directory paths ────────────────────────────────────────────

export function remoteServerStateFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/server.json`;
}

export function remoteAuthTokenFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/auth-token`;
}

export function remoteEnvFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/env`;
}

export function remoteProjectRunDir(projectId: string): string {
  return `$HOME/.t3/run/${projectId}`;
}

// ── tmux helpers ──────────────────────────────────────────────────────

export function tmuxSessionName(projectId: string): string {
  return `t3-${projectId}`.slice(0, 50);
}

export function parseTmuxSessionList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.split(":")[0]?.trim() ?? "")
    .filter((name) => name.length > 0);
}

export function buildTmuxCheckCommand(projectId: string): string {
  const session = tmuxSessionName(projectId);
  return `$HOME/.t3/bin/tmux has-session -t ${session} 2>/dev/null && echo "exists" || echo "absent"`;
}

export function buildTmuxStartCommand(projectId: string, workspaceRoot: string): string {
  const session = tmuxSessionName(projectId);
  const stateFile = remoteServerStateFile(projectId);
  const authFile = remoteAuthTokenFile(projectId);
  const logDir = `$HOME/.t3/run/${projectId}/logs`;
  return [
    `mkdir -p ${logDir}`,
    `&&`,
    `$HOME/.t3/bin/tmux new-session -d -s ${session}`,
    `"$HOME/.t3/bin/t3 serve`,
    `--host 127.0.0.1`,
    `--port 0`,
    `--auth-token-file ${authFile}`,
    `--state-file ${stateFile}`,
    `--log-dir ${logDir}`,
    `--cwd ${workspaceRoot}"`,
  ].join(" ");
}

export function buildTmuxKillCommand(projectId: string): string {
  const session = tmuxSessionName(projectId);
  return `$HOME/.t3/bin/tmux kill-session -t ${session} 2>/dev/null || true`;
}
