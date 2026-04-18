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

/**
 * Linux C library flavor. Matters for picking a matching Bun-compiled server
 * binary — glibc binaries won't run on musl distros (Alpine) and vice versa.
 * On non-Linux platforms this is `undefined`.
 */
export type LinuxLibc = "glibc" | "musl";

export interface ProbeResult {
  os: string;
  arch: string;
  /** Linux libc flavor. `undefined` on non-Linux or when probe couldn't decide. */
  libc?: LinuxLibc;
  currentVersion: string;
}

/**
 * Normalized remote platform — the union of what this app can actually provision.
 * The `libc` field is only meaningful for Linux; kept optional so Darwin resolves
 * cleanly without having to invent a value.
 */
export interface ResolvedPlatform {
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  libc?: LinuxLibc;
}

/** Human-readable list of what we actually support, for error messages. */
export const SUPPORTED_PLATFORMS_DESCRIPTION =
  "Linux (glibc or musl) on x86_64/aarch64, macOS on x86_64/arm64. " +
  "Windows and FreeBSD remotes are not yet supported.";

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

// ── Version normalization ─────────────────────────────────────────────

/**
 * Normalize a version string for comparison.
 * Remote `t3 --version` outputs "t3 v0.0.17", while the local version
 * from package.json is "0.0.17". Strip the "t3 " prefix and leading "v"
 * so both sides compare cleanly.
 */
export function normalizeVersion(version: string): string {
  return version
    .replace(/^t3\s+/i, "")
    .replace(/^v/, "")
    .trim();
}

// ── Remote probe script ───────────────────────────────────────────────

// Probe script sent to the remote. Detects OS, arch, libc flavor (Linux only),
// and any existing t3 install. The libc detection is cheap — we just look for
// the musl dynamic loader under /lib, which is how Alpine and other musl distros
// are reliably distinguishable from glibc distros in a single shell test. Using
// a glob in `ls` works across dash/ash/bash because exit code is non-zero when
// nothing matches (the shell passes the unexpanded glob through to ls).
export const PROBE_SCRIPT = `#!/bin/sh
T3_HOME="$HOME/.t3"
mkdir -p "$T3_HOME/bin" "$T3_HOME/run" "$T3_HOME/logs"
CURRENT_VERSION=""
if [ -x "$T3_HOME/bin/t3" ]; then
  CURRENT_VERSION=$("$T3_HOME/bin/t3" --version 2>/dev/null || echo "")
fi
LIBC=""
if [ "$(uname -s)" = "Linux" ]; then
  if ls /lib/ld-musl-* >/dev/null 2>&1; then
    LIBC="musl"
  else
    LIBC="glibc"
  fi
fi
echo "OS:$(uname -s) ARCH:$(uname -m) LIBC:$LIBC VERSION:$CURRENT_VERSION"
`;

export function parseProbeOutput(output: string): ProbeResult | null {
  // LIBC is new (may be empty on non-Linux); VERSION may contain spaces
  // (e.g. "t3 v0.0.15") so it stays last and absorbs the remainder. The LIBC
  // group is optional so the parser stays tolerant of very old probes that
  // didn't report it — we just treat those as "libc unknown" downstream.
  const withLibc = output
    .trim()
    .match(/^OS:(\S+)\s+ARCH:(\S+)\s+LIBC:(\S*)\s+VERSION:(.*)$/);
  if (withLibc) {
    const libcRaw = withLibc[3]!;
    const libc: LinuxLibc | undefined =
      libcRaw === "musl" || libcRaw === "glibc" ? libcRaw : undefined;
    return {
      os: withLibc[1]!,
      arch: withLibc[2]!,
      ...(libc ? { libc } : {}),
      currentVersion: withLibc[4]!.trim(),
    };
  }
  const legacy = output.trim().match(/^OS:(\S+)\s+ARCH:(\S+)\s+VERSION:(.*)$/);
  if (!legacy) return null;
  return {
    os: legacy[1]!,
    arch: legacy[2]!,
    currentVersion: legacy[3]!.trim(),
  };
}

// ── Platform/arch resolution ──────────────────────────────────────────

const OS_MAP: Record<string, "linux" | "darwin"> = {
  Linux: "linux",
  Darwin: "darwin",
};

// uname -m values vary by OS and distro. Notable variants we accept:
//   x86_64  — Linux, macOS (Intel)
//   amd64   — FreeBSD, some Docker base images, sometimes reported by BSDs
//             (we can't provision FreeBSD remotes, but accepting the arch
//             token means other amd64-reporting environments also resolve)
//   aarch64 — Linux (ARMv8)
//   arm64   — macOS (Apple Silicon), some Linux distros
const ARCH_MAP: Record<string, "x64" | "arm64"> = {
  x86_64: "x64",
  amd64: "x64",
  aarch64: "arm64",
  arm64: "arm64",
};

export function resolveRemotePlatform(
  os: string,
  arch: string,
  libc?: LinuxLibc,
): ResolvedPlatform | null {
  const platform = OS_MAP[os];
  const resolvedArch = ARCH_MAP[arch];
  if (!platform || !resolvedArch) return null;
  if (platform === "linux") {
    // Default unknown-libc Linux to glibc — matches the most common distro
    // family and preserves behavior for older probes that didn't report libc.
    return { platform, arch: resolvedArch, libc: libc ?? "glibc" };
  }
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

export function remoteServerLogFile(projectId: string): string {
  return `$HOME/.t3/run/${projectId}/server-stdout.log`;
}

export function buildTmuxStartCommand(projectId: string, workspaceRoot: string): string {
  const session = tmuxSessionName(projectId);
  const stateFile = remoteServerStateFile(projectId);
  const authFile = remoteAuthTokenFile(projectId);
  const logDir = `$HOME/.t3/run/${projectId}/logs`;
  const stdoutLog = remoteServerLogFile(projectId);
  // Redirect stdout+stderr to a log file so we can tail it remotely for
  // real-time visibility and read it back on startup failures.
  // Verified working command (tested manually on remote):
  //   t3 serve --host 127.0.0.1 --port 0 --auth-token-file <file> --state-file <file>
  //            --log-dir <dir> --headless <cwd> > <log> 2>&1
  // Notes:
  //   - --port 0 asks the OS for a free ephemeral port. Required when multiple
  //     remote projects run on the same host — they used to fight over the
  //     default 3773. The actually-bound port is written to the state file,
  //     which the client reads to set up its local tunnel.
  //   - cwd is a positional argument, not --cwd
  //   - --headless skips static file serving
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
    `--headless`,
    `${workspaceRoot}`,
    `> ${stdoutLog} 2>&1"`,
  ].join(" ");
}

export function buildTmuxKillCommand(projectId: string): string {
  const session = tmuxSessionName(projectId);
  return `$HOME/.t3/bin/tmux kill-session -t ${session} 2>/dev/null || true`;
}
