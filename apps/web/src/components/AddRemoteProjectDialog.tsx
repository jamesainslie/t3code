import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_MODEL_BY_PROVIDER } from "@t3tools/contracts";
import type { DesktopSshProvisioningEvent, SavedSshHost } from "@t3tools/contracts";
import { Loader2Icon, CheckCircle2Icon, XCircleIcon, CircleIcon } from "lucide-react";
import { newCommandId, newProjectId } from "../lib/utils";
import { readEnvironmentApi } from "../environmentApi";
import { addOrReconnectSavedEnvironment } from "../environments/runtime/service";
import { isElectron } from "../env";

type Status = "idle" | "provisioning" | "registering" | "creating-project" | "connected" | "error";

const NEW_HOST_VALUE = "__new__";

interface ProvisionPhase {
  phase: number;
  label: string;
  status: "pending" | "active" | "complete" | "error";
  logs: string[];
}

const INITIAL_PHASES: ProvisionPhase[] = [
  { phase: 1, label: "Establishing SSH connection", status: "pending", logs: [] },
  { phase: 2, label: "Probing remote environment", status: "pending", logs: [] },
  { phase: 3, label: "Transferring binaries", status: "pending", logs: [] },
  { phase: 4, label: "Starting remote server", status: "pending", logs: [] },
  { phase: 5, label: "Setting up secure tunnel", status: "pending", logs: [] },
];

function PhaseIcon({ status }: { status: ProvisionPhase["status"] }) {
  switch (status) {
    case "active":
      return <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />;
    case "complete":
      return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />;
    case "error":
      return <XCircleIcon className="size-4 shrink-0 text-destructive" />;
    case "pending":
    default:
      return <CircleIcon className="size-4 shrink-0 text-muted-foreground/40" />;
  }
}

function ProvisionTimeline({
  phases,
  errorMessage,
  postProvisionStatus,
}: {
  phases: ProvisionPhase[];
  errorMessage: string | null;
  postProvisionStatus: "registering" | "creating-project" | "connected" | null;
}) {
  return (
    <div className="flex flex-col gap-0">
      {phases.map((p, i) => {
        const isLast = i === phases.length - 1 && !postProvisionStatus;
        return (
          <div key={p.phase} className="flex gap-3">
            {/* Vertical line + icon column */}
            <div className="flex flex-col items-center">
              <PhaseIcon status={p.status} />
              {!isLast && (
                <div className="w-px flex-1 bg-border" />
              )}
            </div>
            {/* Content */}
            <div className="flex flex-col gap-0.5 pb-3 min-w-0">
              <span
                className={`text-xs font-medium leading-4 ${
                  p.status === "active"
                    ? "text-foreground"
                    : p.status === "complete"
                      ? "text-muted-foreground"
                      : p.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground/50"
                }`}
              >
                {p.label}
              </span>
              {p.logs.map((log, j) => (
                <span
                  key={j}
                  className="text-[10px] font-mono text-muted-foreground leading-3.5 break-all"
                >
                  {log}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {/* Post-provision steps */}
      {postProvisionStatus && (
        <>
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              {postProvisionStatus === "registering" ? (
                <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
              ) : postProvisionStatus === "creating-project" || postProvisionStatus === "connected" ? (
                <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleIcon className="size-4 shrink-0 text-muted-foreground/40" />
              )}
              <div className="w-px flex-1 bg-border" />
            </div>
            <div className="pb-3">
              <span
                className={`text-xs font-medium leading-4 ${
                  postProvisionStatus === "registering"
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                Registering environment
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              {postProvisionStatus === "creating-project" ? (
                <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
              ) : postProvisionStatus === "connected" ? (
                <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <CircleIcon className="size-4 shrink-0 text-muted-foreground/40" />
              )}
            </div>
            <div className="pb-1">
              <span
                className={`text-xs font-medium leading-4 ${
                  postProvisionStatus === "creating-project"
                    ? "text-foreground"
                    : postProvisionStatus === "connected"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                }`}
              >
                Creating project
              </span>
            </div>
          </div>
        </>
      )}
      {/* Error message */}
      {errorMessage && (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

interface AddRemoteProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AddRemoteProjectDialog({ open, onClose }: AddRemoteProjectDialogProps) {
  const [savedHosts, setSavedHosts] = useState<SavedSshHost[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>(NEW_HOST_VALUE);
  const [saveHost, setSaveHost] = useState(true);
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [phases, setPhases] = useState<ProvisionPhase[]>(INITIAL_PHASES);
  const cleanupRef = useRef<(() => void) | null>(null);
  const currentProjectIdRef = useRef<string | null>(null);

  const resetForm = useCallback(() => {
    setSelectedHostId(NEW_HOST_VALUE);
    setSaveHost(true);
    setHost("");
    setUser("");
    setPort("22");
    setWorkspaceRoot("");
    setLabel("");
    setError(null);
    setStatus("idle");
    setPhases(INITIAL_PHASES);
    currentProjectIdRef.current = null;
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
  }, []);

  // Load saved hosts when the dialog opens
  useEffect(() => {
    if (!open) return;
    if (!isElectron || !window.desktopBridge) return;
    void window.desktopBridge.getSavedSshHosts().then((hosts) => {
      setSavedHosts(hosts);
    });
  }, [open]);

  // Clean up listener on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  function handleHostSelect(value: string) {
    setSelectedHostId(value);
    if (value === NEW_HOST_VALUE) {
      setHost("");
      setUser("");
      setPort("22");
      setSaveHost(true);
      return;
    }
    const selected = savedHosts.find((h) => h.id === value);
    if (selected) {
      setHost(selected.host);
      setUser(selected.user);
      setPort(String(selected.port));
      setSaveHost(false);
    }
  }

  function formatHostOption(h: SavedSshHost): string {
    const portSuffix = h.port !== 22 ? `:${h.port}` : "";
    return h.label || `${h.user}@${h.host}${portSuffix}`;
  }

  function handleProvisionEvent(event: DesktopSshProvisioningEvent) {
    if (event.projectId !== currentProjectIdRef.current) return;

    setPhases((prev) => {
      const next = prev.map((p) => ({ ...p, logs: [...p.logs] }));

      if (event.type === "phase-start" && event.phase != null) {
        const idx = next.findIndex((p) => p.phase === event.phase);
        const entry = next[idx];
        if (entry) {
          entry.status = "active";
          entry.logs = [];
          if (event.label) entry.label = event.label;
        }
      } else if (event.type === "phase-complete" && event.phase != null) {
        const idx = next.findIndex((p) => p.phase === event.phase);
        const entry = next[idx];
        if (entry) {
          entry.status = "complete";
          if (event.label) entry.label = event.label;
        }
      } else if (event.type === "log" && event.phase != null && event.message) {
        const idx = next.findIndex((p) => p.phase === event.phase);
        const entry = next[idx];
        if (entry) {
          entry.logs.push(event.message);
        }
      } else if (event.type === "error") {
        if (event.phase != null) {
          const idx = next.findIndex((p) => p.phase === event.phase);
          const entry = next[idx];
          if (entry) {
            entry.status = "error";
          }
        }
      }

      return next;
    });

    if (event.type === "error" && event.message) {
      setError(event.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhases(INITIAL_PHASES);

    if (!isElectron || !window.desktopBridge) {
      setError("Remote SSH projects require the desktop app.");
      return;
    }

    const projectId = newProjectId();
    currentProjectIdRef.current = projectId;
    const trimmedLabel = label.trim();
    const displayLabel = trimmedLabel || `${user.trim()}@${host.trim()}`;

    // Subscribe to granular provisioning events
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    cleanupRef.current = window.desktopBridge.onSshProvisionEvent(handleProvisionEvent);

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
      const { record, isReconnect } = await addOrReconnectSavedEnvironment({
        label: displayLabel,
        pairingUrl: sshResult.pairingUrl,
        projectId,
        sshConfig: {
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
          projectId,
          workspaceRoot: workspaceRoot.trim(),
        },
      });

      // Phase 3: Create project on the remote server (skip if reconnecting — project already exists)
      if (!isReconnect) {
        setStatus("creating-project");
        const remoteApi = record.environmentId ? readEnvironmentApi(record.environmentId) : null;
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
      }

      // Save host if checkbox is checked and this is a new host
      if (saveHost && selectedHostId === NEW_HOST_VALUE && window.desktopBridge) {
        await window.desktopBridge.saveSshHost({
          id: crypto.randomUUID(),
          label: trimmedLabel,
          host: host.trim(),
          user: user.trim(),
          port: Number(port) || 22,
        });
      }

      // Backward-compat: also record for warm-up
      await window.desktopBridge.recordRemoteHost({
        host: host.trim(),
        user: user.trim(),
        port: Number(port) || 22,
      });

      // Show connected state briefly, then close
      setStatus("connected");
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setTimeout(() => {
        resetForm();
        onClose();
      }, 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    }
  }

  function handleRetry() {
    setError(null);
    setStatus("idle");
    setPhases(INITIAL_PHASES);
    currentProjectIdRef.current = null;
  }

  const isSubmitting = status !== "idle" && status !== "error";
  const showTimeline = status !== "idle";
  const isNewHost = selectedHostId === NEW_HOST_VALUE;

  const postProvisionStatus =
    status === "registering"
      ? ("registering" as const)
      : status === "creating-project"
        ? ("creating-project" as const)
        : status === "connected"
          ? ("connected" as const)
          : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          resetForm();
          onClose();
        }
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-2xl">
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          {showTimeline ? "Connecting to Remote" : "Add Remote Project"}
        </h2>

        {showTimeline ? (
          <div className="flex flex-col gap-4">
            <ProvisionTimeline
              phases={phases}
              errorMessage={error}
              postProvisionStatus={postProvisionStatus}
            />

            {status === "connected" && (
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2">
                <CheckCircle2Icon className="size-4 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-500">Connected</span>
              </div>
            )}

            <div className="mt-1 flex justify-end gap-2">
              {status === "error" && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      onClose();
                    }}
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Retry
                  </button>
                </>
              )}
              {isSubmitting && (
                <button
                  type="button"
                  disabled
                  className="rounded-md px-3 py-1.5 text-xs text-muted-foreground/70 opacity-40"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
            {savedHosts.length > 0 && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">Saved Hosts</span>
                <select
                  className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground focus:border-ring focus:outline-none"
                  value={selectedHostId}
                  onChange={(e) => handleHostSelect(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value={NEW_HOST_VALUE}>New host...</option>
                  {savedHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {formatHostOption(h)}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
              <span className="text-[11px] font-medium text-muted-foreground">
                Label (optional)
              </span>
              <input
                className="rounded-md border border-border bg-card px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My Dev Server"
                disabled={isSubmitting}
              />
            </label>
            {isNewHost && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={saveHost}
                  onChange={(e) => setSaveHost(e.target.checked)}
                  disabled={isSubmitting}
                  className="rounded border-border"
                />
                <span className="text-[11px] font-medium text-muted-foreground">
                  Save this host
                </span>
              </label>
            )}
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
                Connect
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
