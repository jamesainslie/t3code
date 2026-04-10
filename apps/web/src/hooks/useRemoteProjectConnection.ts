import { useCallback, useEffect, useRef } from "react";
import type { OrchestrationProject } from "@t3tools/contracts";
import { connectRemoteProject, disconnectRemoteProject } from "../rpc/brokerClient";
import { useRemoteConnectionStore } from "../remoteConnectionStore";

const DEFAULT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const DEFAULT_MAX_RETRY_DURATION_MS = 5 * 60 * 1_000; // 5 minutes

interface RemoteConnectionManagerOptions {
  maxRetryDurationMs?: number;
  backoffMs?: readonly number[];
}

/**
 * Pure connection manager encapsulating SSH connect/retry/disconnect logic.
 * Extracted from the hook so it can be tested without a React environment.
 */
export function createRemoteConnectionManager(
  project: OrchestrationProject | null | undefined,
  options: RemoteConnectionManagerOptions = {},
) {
  const { maxRetryDurationMs = DEFAULT_MAX_RETRY_DURATION_MS, backoffMs = DEFAULT_BACKOFF_MS } =
    options;

  let aborted = false;
  let retryCount = 0;
  let startTime = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  async function connect(): Promise<void> {
    if (!project?.remoteHost || aborted) return;

    const { host, user, port = 22 } = project.remoteHost;
    const projectId = project.id;
    startTime = startTime || Date.now();

    const { setStatus } = useRemoteConnectionStore.getState();
    setStatus(projectId, "provisioning");

    try {
      const { wsUrl } = await connectRemoteProject({
        projectId,
        host,
        user,
        port,
        workspaceRoot: project.workspaceRoot,
      });

      if (aborted) return;

      retryCount = 0;
      setStatus(projectId, "connected", { wsUrl });
    } catch (err) {
      if (aborted) return;

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxRetryDurationMs) {
        setStatus(projectId, "error", {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      setStatus(projectId, "reconnecting");
      const delay = backoffMs[Math.min(retryCount, backoffMs.length - 1)] ?? 30_000;
      retryCount += 1;
      await new Promise<void>((resolve) => {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          resolve();
        }, delay);
      });

      await connect();
    }
  }

  function dispose(): void {
    aborted = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (project?.id) {
      void disconnectRemoteProject(project.id);
      useRemoteConnectionStore.getState().setStatus(project.id, "disconnected");
    }
  }

  return { connect, dispose };
}

/**
 * Manages the SSH connection lifecycle for a remote project.
 *
 * - Connects when mounted (or when the project changes to a remote project)
 * - Auto-reconnects with exponential backoff on failure
 * - Disconnects and cleans up on unmount
 * - No-op for local projects (no remoteHost)
 */
export function useRemoteProjectConnection(project: OrchestrationProject | null | undefined): void {
  const managerRef = useRef<ReturnType<typeof createRemoteConnectionManager> | null>(null);

  const connect = useCallback(async () => {
    const manager = createRemoteConnectionManager(project);
    managerRef.current = manager;
    await manager.connect();
  }, [project]);

  useEffect(() => {
    if (!project?.remoteHost) return;

    void connect();

    return () => {
      managerRef.current?.dispose();
      managerRef.current = null;
    };
  }, [project?.id, project?.remoteHost, connect]);
}
