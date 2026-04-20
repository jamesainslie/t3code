import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import { newCommandId, newProjectId } from "../lib/utils";
import { readEnvironmentApi } from "../environmentApi";
import { addSavedEnvironment } from "../environments/runtime/service";
import { isElectron } from "../env";

type Status = "idle" | "provisioning" | "registering" | "creating-project";

interface AddRemoteProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddRemoteProjectDialog({ open, onClose }: AddRemoteProjectDialogProps) {
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const resetForm = useCallback(() => {
    setHost("");
    setUser("");
    setPort("22");
    setWorkspaceRoot("");
    setLabel("");
    setError(null);
    setStatus("idle");
  }, []);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isElectron || !window.desktopBridge) {
      setError("Remote SSH projects require the desktop app.");
      return;
    }

    const projectId = newProjectId();
    const trimmedLabel = label.trim();
    const displayLabel = trimmedLabel || `${user.trim()}@${host.trim()}`;

    try {
      // Phase 1: Provision SSH tunnel
      setStatus("provisioning");
      const sshResult = await window.desktopBridge.sshConnect({
        projectId,
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
        workspaceRoot: workspaceRoot.trim(),
      });

      if (!sshResult.pairingUrl) {
        throw new Error(
          "Remote server did not provide a pairing URL. The server may be too old — ensure the remote binary matches the local version.",
        );
      }

      // Phase 2: Register as a saved environment (with SSH config for reconnection)
      setStatus("registering");
      const record = await addSavedEnvironment({
        label: displayLabel,
        pairingUrl: sshResult.pairingUrl,
        sshConfig: {
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
          projectId,
          workspaceRoot: workspaceRoot.trim(),
        },
      });

      // Phase 3: Create project on the remote server
      setStatus("creating-project");
      if (!record.environmentId) {
        throw new Error("Remote environment registration did not return an environment id.");
      }
      const remoteApi = readEnvironmentApi(record.environmentId);
      if (!remoteApi) {
        throw new Error("Failed to connect to the remote environment after registration.");
      }

      await remoteApi.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: displayLabel,
        workspaceRoot: workspaceRoot.trim(),
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        createdAt: new Date().toISOString(),
      });

      // Record host for warm-up on next launch
      await window.desktopBridge.recordRemoteHost({
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
      });

      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("idle");
    }
  }

  const statusMessages: Record<Status, string> = {
    idle: "Add Remote Project",
    provisioning: "Provisioning SSH tunnel...",
    registering: "Registering remote environment...",
    "creating-project": "Creating project on remote...",
  };

  const isSubmitting = status !== "idle";

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-2xl">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Add Remote Project</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Host</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="devbox or 192.168.1.10"
              required
              disabled={isSubmitting}
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">User</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="james"
              required
              disabled={isSubmitting}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Port</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
              type="number"
              min={1}
              max={65535}
              disabled={isSubmitting}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Remote workspace path
            </span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="/home/james/myapp"
              required
              disabled={isSubmitting}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Label (optional)</span>
            <input
              className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Dev Server"
              disabled={isSubmitting}
            />
          </label>
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (!isSubmitting) {
                  resetForm();
                  onClose();
                }
              }}
              disabled={isSubmitting}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {statusMessages[status]}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
