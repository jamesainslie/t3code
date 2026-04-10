import { useState } from "react";
import { DEFAULT_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import { newCommandId, newProjectId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";

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
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const api = readNativeApi();
    if (!api) {
      setError("Native API unavailable");
      setSubmitting(false);
      return;
    }

    try {
      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const trimmedLabel = label.trim();
      const title = trimmedLabel || `${user.trim()}@${host.trim()}`;

      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title,
        workspaceRoot: workspaceRoot.trim(),
        remoteHost: {
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
          ...(trimmedLabel ? { label: trimmedLabel } : {}),
        },
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        createdAt,
      });

      setHost("");
      setUser("");
      setPort("22");
      setWorkspaceRoot("");
      setLabel("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-sidebar p-6 shadow-xl">
        <h2 className="mb-4 text-sm font-semibold text-foreground">Add Remote Project</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Host</span>
            <input
              className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="devbox or 192.168.1.10"
              required
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">User</span>
            <input
              className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="james"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Port</span>
            <input
              className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
              type="number"
              min={1}
              max={65535}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Remote workspace path
            </span>
            <input
              className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="/home/james/myapp"
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Label (optional)</span>
            <input
              className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Dev Server"
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
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add Remote Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
