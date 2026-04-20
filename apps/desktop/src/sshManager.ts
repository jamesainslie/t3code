import * as Path from "node:path";

import { app } from "electron";
import { provision, type ProvisionResult } from "@t3tools/shared/provision";
import { SshConnectionManager } from "@t3tools/shared/sshManager";

export const globalSshManager = new SshConnectionManager();
const activeConnections = new Map<string, ProvisionResult & { wsUrl: string }>();

/**
 * Resolve the directory containing SSH remote binaries (t3-server-*, tmux-*).
 *
 * Packaged app: binaries are in `resources/ssh-binaries/` relative to the asar.
 * Dev mode: binaries are in `dist/ssh-binaries/` at the monorepo root (built
 * by `scripts/build-ssh-binaries.sh` or manually via `bun build --compile`).
 */
function resolveSshBinariesDir(): string {
  if (app.isPackaged) {
    return Path.join(process.resourcesPath, "ssh-binaries");
  }
  // Dev mode: __dirname is apps/desktop/dist-electron/
  // Monorepo root is three levels up
  const monorepoRoot = Path.resolve(__dirname, "../../..");
  return Path.join(monorepoRoot, "dist", "ssh-binaries");
}

export interface SshConnectOptions {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  localVersion: string;
  onStatus: (phase: "provisioning" | "starting" | "connected") => void;
  onLog?: ((line: string) => void) | undefined;
}

export interface SshConnectResult {
  wsUrl: string;
  httpBaseUrl: string;
  pairingUrl: string | undefined;
}

export async function sshConnect(opts: SshConnectOptions): Promise<SshConnectResult> {
  const binDir = resolveSshBinariesDir();
  const result = await provision({
    target: { host: opts.host, user: opts.user, port: opts.port },
    projectId: opts.projectId,
    workspaceRoot: opts.workspaceRoot,
    localVersion: opts.localVersion,
    serverBinaryPath: (platform, arch, libc) => {
      // Linux remotes pick a libc-correct Bun binary: musl on Alpine/Void, glibc
      // on Debian/RHEL/etc. The glibc variant keeps its historical unsuffixed
      // filename so older bundles without musl support still resolve cleanly.
      const libcSuffix = platform === "linux" && libc === "musl" ? "-musl" : "";
      return Path.join(binDir, `t3-server-${platform}-${arch}${libcSuffix}`);
    },
    // Darwin remotes: no bundled tmux (Homebrew's tmux depends on relocatable
    // dylibs, so we can't ship a portable Darwin static tmux). Returning null
    // tells the provisioner to locate the remote's tmux via `command -v tmux`
    // and symlink it into ~/.t3/bin/tmux. See download-tmux-binaries.sh.
    //
    // The vendored tmux binaries from pythops/tmux-linux-binary are fully
    // static so a single binary covers both glibc and musl — libc is ignored.
    tmuxBinaryPath: (platform, arch) =>
      platform === "darwin" ? null : Path.join(binDir, `tmux-${platform}-${arch}`),
    sshManager: globalSshManager,
    onStatus: opts.onStatus,
    ...(opts.onLog != null ? { onLog: opts.onLog } : {}),
  });
  const wsUrl = `ws://127.0.0.1:${result.localPort}`;
  const httpBaseUrl = `http://127.0.0.1:${result.localPort}`;

  // Rewrite the pairing URL to use the tunnel endpoint instead of localhost:<remotePort>
  let pairingUrl = result.pairingUrl;
  if (pairingUrl) {
    try {
      const parsed = new URL(pairingUrl);
      parsed.hostname = "127.0.0.1";
      parsed.port = String(result.localPort);
      pairingUrl = parsed.toString();
    } catch {
      // Leave as-is if URL parsing fails
    }
  }

  activeConnections.set(opts.projectId, { ...result, wsUrl });
  return { wsUrl, httpBaseUrl, pairingUrl };
}

export function sshDisconnect(projectId: string): void {
  activeConnections.delete(projectId);
}

export function sshGetStatus(): { connections: Array<{ projectId: string; wsUrl: string }> } {
  return {
    connections: Array.from(activeConnections.entries()).map(([projectId, c]) => ({
      projectId,
      wsUrl: c.wsUrl,
    })),
  };
}

export function sshCloseAll(): void {
  globalSshManager.closeAll();
  activeConnections.clear();
}
