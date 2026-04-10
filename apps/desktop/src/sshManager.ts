import * as Path from "node:path";

import { app } from "electron";
import { provision, type ProvisionResult } from "@t3tools/shared/provision";
import { SshConnectionManager } from "@t3tools/shared/sshManager";

export const globalSshManager = new SshConnectionManager();
const activeConnections = new Map<string, ProvisionResult & { wsUrl: string }>();

export interface SshConnectOptions {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
  localVersion: string;
  onStatus: (phase: string) => void;
}

export async function sshConnect(opts: SshConnectOptions): Promise<{ wsUrl: string }> {
  const result = await provision({
    target: { host: opts.host, user: opts.user, port: opts.port },
    projectId: opts.projectId,
    workspaceRoot: opts.workspaceRoot,
    localVersion: opts.localVersion,
    serverBinaryPath: (platform, arch) =>
      Path.join(app.getAppPath(), "resources", "ssh-binaries", `t3-server-${platform}-${arch}`),
    tmuxBinaryPath: (platform, arch) =>
      Path.join(app.getAppPath(), "resources", "ssh-binaries", `tmux-${platform}-${arch}`),
    sshManager: globalSshManager,
    onStatus: opts.onStatus,
  });
  const wsUrl = `ws://127.0.0.1:${result.localPort}`;
  activeConnections.set(opts.projectId, { ...result, wsUrl });
  return { wsUrl };
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
