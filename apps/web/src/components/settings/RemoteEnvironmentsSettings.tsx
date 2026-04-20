import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnvironmentId, RemoteIdentityKey, SavedRemoteEnvironment } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  InfoIcon,
  TrashIcon,
  XCircleIcon,
} from "lucide-react";

import {
  type SavedEnvironmentConnectionState,
  type SavedEnvironmentRuntimeState,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  disconnectSavedEnvironment,
  reconnectSavedEnvironment,
  removeSavedEnvironment,
  useConnectionLogStore,
  type ConnectionLogEntry,
} from "~/environments/runtime";
import { RemoteConnectionIcon } from "../RemoteConnectionIcon";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsSection } from "./settingsLayout";

const CONNECTION_STATE_LABELS: Record<SavedEnvironmentConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
  error: "Error",
};

function formatRelativeTimeShort(isoString: string | null): string {
  if (!isoString) return "Never";
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (diffMs < 0) return "Just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLogTime(isoString: string): string {
  const date = new Date(isoString);
  return [
    date.getHours().toString().padStart(2, "0"),
    date.getMinutes().toString().padStart(2, "0"),
    date.getSeconds().toString().padStart(2, "0"),
  ].join(":");
}

const ROW_CLASSNAME = "border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5";

// ---------- Remote environment row ----------

interface RemoteEnvironmentRowProps {
  readonly environmentId: EnvironmentId;
  readonly record: SavedRemoteEnvironment & { environmentId: EnvironmentId };
  readonly label: string;
  readonly host: string;
  readonly user: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly lastConnectedAt: string | null;
  readonly identityKey: RemoteIdentityKey;
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly runtimeState: SavedEnvironmentRuntimeState | null;
  readonly onReconnect: (environmentId: EnvironmentId) => void;
  readonly onDisconnect: (environmentId: EnvironmentId) => void;
  readonly onRemove: (environmentId: EnvironmentId) => void;
  readonly isActing: boolean;
}

function DebugStateInspector({
  record,
  runtimeState,
}: {
  readonly record: SavedRemoteEnvironment;
  readonly runtimeState: SavedEnvironmentRuntimeState | null;
}) {
  const handleDumpToConsole = useCallback(() => {
    console.group(`[debug] Remote Environment: ${record.label}`);
    console.log("Record:", record);
    console.log("Runtime:", runtimeState);
    console.groupEnd();
  }, [record, runtimeState]);

  return (
    <div className="mt-2 space-y-1 rounded border border-border/40 bg-muted/30 p-2 font-mono text-[11px] text-muted-foreground">
      <div>
        <span className="text-muted-foreground/70">identityKey:</span> {record.identityKey}
      </div>
      <div>
        <span className="text-muted-foreground/70">environmentId:</span>{" "}
        {record.environmentId ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">httpBaseUrl:</span>{" "}
        {record.httpBaseUrl ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">wsBaseUrl:</span> {record.wsBaseUrl ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">connectionState:</span>{" "}
        {runtimeState?.connectionState ?? "unknown"}
      </div>
      <div>
        <span className="text-muted-foreground/70">authState:</span>{" "}
        {runtimeState?.authState ?? "unknown"}
      </div>
      <div>
        <span className="text-muted-foreground/70">role:</span> {runtimeState?.role ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">connectedAt:</span>{" "}
        {runtimeState?.connectedAt ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">disconnectedAt:</span>{" "}
        {runtimeState?.disconnectedAt ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">lastError:</span>{" "}
        {runtimeState?.lastError ?? "null"}
      </div>
      <div>
        <span className="text-muted-foreground/70">sshConfig:</span> {record.user}@{record.host}:
        {record.port} {record.workspaceRoot}
      </div>
      <div>
        <span className="text-muted-foreground/70">bearer:</span>{" "}
        {runtimeState?.authState === "authenticated" ? "present" : "missing"}
      </div>
      <div className="pt-1">
        <Button size="xs" variant="outline" onClick={handleDumpToConsole}>
          Dump to console
        </Button>
      </div>
    </div>
  );
}

function RemoteEnvironmentRow({
  environmentId,
  record,
  label,
  host,
  user,
  port,
  workspaceRoot,
  lastConnectedAt,
  connectionState,
  onReconnect,
  onDisconnect,
  onRemove,
  isActing,
}: RemoteEnvironmentRowProps) {
  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const [debugOpen, setDebugOpen] = useState(false);
  const runtimeState = useSavedEnvironmentRuntimeStore(
    (state) => state.byId[environmentId],
  );

  return (
    <div className={ROW_CLASSNAME}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <RemoteConnectionIcon state={connectionState} />
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="text-xs text-muted-foreground">
              {CONNECTION_STATE_LABELS[connectionState]}
            </span>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {user}@{host}:{port} {workspaceRoot}
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Last connected: {formatRelativeTimeShort(lastConnectedAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDebugOpen((prev) => !prev)}
            aria-label="Toggle debug info"
          >
            {debugOpen ? (
              <ChevronDownIcon className="mr-1 size-3" />
            ) : (
              <ChevronRightIcon className="mr-1 size-3" />
            )}
            Debug
          </Button>
          {isConnected ? (
            <Button
              size="xs"
              variant="outline"
              disabled={isActing}
              onClick={() => onDisconnect(environmentId)}
            >
              Disconnect
            </Button>
          ) : (
            <Button
              size="xs"
              variant="outline"
              disabled={isActing || isConnecting}
              onClick={() => onReconnect(environmentId)}
            >
              Reconnect
            </Button>
          )}
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={isActing}
            onClick={() => onRemove(environmentId)}
          >
            Remove
          </Button>
        </div>
      </div>
      {debugOpen && runtimeState ? (
        <DebugStateInspector record={record} runtimeState={runtimeState} />
      ) : null}
    </div>
  );
}

// ---------- Connection log viewer ----------

const LOG_LEVEL_STYLES: Record<
  ConnectionLogEntry["level"],
  { icon: typeof InfoIcon; className: string }
> = {
  info: { icon: InfoIcon, className: "text-muted-foreground" },
  warn: { icon: AlertTriangleIcon, className: "text-amber-500" },
  error: { icon: XCircleIcon, className: "text-destructive" },
};

export function ConnectionLogViewer() {
  const entries = useConnectionLogStore((state) => state.entries);
  const clearLog = useConnectionLogStore((state) => state.clear);
  const [filter, setFilter] = useState<"all" | "errors">("all");

  const filtered = useMemo(() => {
    const base = filter === "errors" ? entries.filter((e) => e.level === "error") : entries;
    return [...base].reverse();
  }, [entries, filter]);

  const handleCopy = useCallback(() => {
    const text = filtered
      .map((e) => {
        const ts = formatLogTime(e.timestamp);
        const ctx = [e.label, e.identityKey].filter(Boolean).join(" ");
        const prefix = ctx ? ` [${ctx}]` : "";
        return `[${ts}] [${e.level}] [${e.source}]${prefix} ${e.message}`;
      })
      .join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      toastManager.add({ type: "info", title: "Connection log copied to clipboard" });
    });
  }, [filtered]);

  return (
    <SettingsSection title="Connection Log">
      <div className="px-4 pt-3 pb-1 sm:px-5">
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            All
          </Button>
          <Button
            size="xs"
            variant={filter === "errors" ? "default" : "outline"}
            onClick={() => setFilter("errors")}
          >
            Errors only
          </Button>
          <div className="flex-1" />
          <Button size="xs" variant="ghost" onClick={handleCopy} aria-label="Copy log to clipboard">
            <ClipboardCopyIcon className="mr-1 size-3" />
            Copy
          </Button>
          <Button size="xs" variant="ghost" onClick={clearLog} aria-label="Clear log">
            <TrashIcon className="mr-1 size-3" />
            Clear
          </Button>
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto px-4 pt-1 pb-3 sm:px-5">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No log entries.</p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((entry) => {
              const style = LOG_LEVEL_STYLES[entry.level];
              const Icon = style.icon;
              return (
                <div key={entry.id} className={`flex items-start gap-1.5 text-[11px] ${style.className}`}>
                  <Icon className="mt-0.5 size-3 shrink-0" />
                  <span className="shrink-0 font-mono text-muted-foreground/60">
                    {formatLogTime(entry.timestamp)}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground/80">
                    [{entry.source}]
                  </span>
                  <span className="break-all">{entry.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}

// ---------- Pure presentational component (testable with renderToStaticMarkup) ----------

export interface RemoteEnvironmentEntry {
  readonly record: SavedRemoteEnvironment;
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly runtimeState: SavedEnvironmentRuntimeState | null;
}

export interface RemoteEnvironmentsSectionViewProps {
  readonly entries: ReadonlyArray<RemoteEnvironmentEntry>;
  readonly actingEnvironmentId: EnvironmentId | null;
  readonly onReconnect: (environmentId: EnvironmentId) => void;
  readonly onDisconnect: (environmentId: EnvironmentId) => void;
  readonly onRemove: (environmentId: EnvironmentId) => void;
  readonly onRemoveAllDisconnected: () => void;
}

export function RemoteEnvironmentsSectionView({
  entries,
  actingEnvironmentId,
  onReconnect,
  onDisconnect,
  onRemove,
  onRemoveAllDisconnected,
}: RemoteEnvironmentsSectionViewProps) {
  const hasDisconnected = entries.some(
    (e) => e.connectionState === "disconnected" || e.connectionState === "error",
  );

  if (entries.length === 0) {
    return (
      <SettingsSection title="Remote Environments">
        <div className={ROW_CLASSNAME}>
          <p className="text-xs text-muted-foreground">No remote environments saved.</p>
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection title="Remote Environments">
      {entries.map(({ record, connectionState, runtimeState }) => (
        <RemoteEnvironmentRow
          key={record.identityKey}
          environmentId={record.environmentId!}
          record={record as SavedRemoteEnvironment & { environmentId: EnvironmentId }}
          label={record.label}
          host={record.host}
          user={record.user}
          port={record.port}
          workspaceRoot={record.workspaceRoot}
          lastConnectedAt={record.lastConnectedAt}
          identityKey={record.identityKey}
          connectionState={connectionState}
          runtimeState={runtimeState}
          record={record}
          onReconnect={onReconnect}
          onDisconnect={onDisconnect}
          onRemove={onRemove}
          isActing={actingEnvironmentId === record.environmentId}
        />
      ))}
      {hasDisconnected ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <Button size="xs" variant="outline" onClick={onRemoveAllDisconnected}>
            Remove all disconnected
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  );
}

// ---------- Connected wrapper (reads from stores) ----------

export function RemoteEnvironmentsSection() {
  const byIdentityKey = useSavedEnvironmentRegistryStore((state) => state.byIdentityKey);
  const runtimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);
  const [actingEnvironmentId, setActingEnvironmentId] = useState<EnvironmentId | null>(null);

  const entries: RemoteEnvironmentEntry[] = useMemo(
    () =>
      Object.values(byIdentityKey)
        .filter(
          (r): r is SavedRemoteEnvironment & { environmentId: EnvironmentId } =>
            r.environmentId !== null,
        )
        .toSorted((a, b) => a.label.localeCompare(b.label))
        .map((record) => ({
          record,
          connectionState:
            (runtimeById[record.environmentId]
              ?.connectionState as SavedEnvironmentConnectionState) ?? "disconnected",
          runtimeState: runtimeById[record.environmentId] ?? null,
        })),
    [byIdentityKey, runtimeById],
  );

  const handleReconnect = useCallback(async (environmentId: EnvironmentId) => {
    setActingEnvironmentId(environmentId);
    try {
      await reconnectSavedEnvironment(environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Reconnect failed",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActingEnvironmentId(null);
    }
  }, []);

  const handleDisconnect = useCallback(async (environmentId: EnvironmentId) => {
    setActingEnvironmentId(environmentId);
    try {
      await disconnectSavedEnvironment(environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Disconnect failed",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActingEnvironmentId(null);
    }
  }, []);

  const handleRemove = useCallback(async (environmentId: EnvironmentId) => {
    setActingEnvironmentId(environmentId);
    try {
      await removeSavedEnvironment(environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setActingEnvironmentId(null);
    }
  }, []);

  const handleRemoveAllDisconnected = useCallback(async () => {
    const toRemove = entries.filter(
      (e) => e.connectionState === "disconnected" || e.connectionState === "error",
    );
    for (const { record } of toRemove) {
      try {
        await removeSavedEnvironment(record.environmentId!);
      } catch {
        // continue removing others
      }
    }
  }, [entries]);

  return (
    <RemoteEnvironmentsSectionView
      entries={entries}
      actingEnvironmentId={actingEnvironmentId}
      onReconnect={(id) => void handleReconnect(id)}
      onDisconnect={(id) => void handleDisconnect(id)}
      onRemove={(id) => void handleRemove(id)}
      onRemoveAllDisconnected={() => void handleRemoveAllDisconnected()}
    />
  );
}

// ---------- Helpers ----------

const LOG_LEVEL_COLORS: Record<ConnectionLogEntry["level"], string> = {
  info: "text-muted-foreground",
  warn: "text-yellow-500",
  error: "text-red-500",
};

