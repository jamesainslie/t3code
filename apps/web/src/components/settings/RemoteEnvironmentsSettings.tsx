import { useCallback, useMemo, useState } from "react";
import type { EnvironmentId, RemoteIdentityKey, SavedRemoteEnvironment } from "@t3tools/contracts";

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

const ROW_CLASSNAME = "border-t border-border/60 px-4 py-3 first:border-t-0 sm:px-5";

interface RemoteEnvironmentRowProps {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly host: string;
  readonly user: string;
  readonly port: number;
  readonly workspaceRoot: string;
  readonly lastConnectedAt: string | null;
  readonly identityKey: RemoteIdentityKey;
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly runtimeState: SavedEnvironmentRuntimeState | null;
  readonly record: SavedRemoteEnvironment;
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
      <div><span className="text-muted-foreground/70">identityKey:</span> {record.identityKey}</div>
      <div><span className="text-muted-foreground/70">environmentId:</span> {record.environmentId ?? "null"}</div>
      <div><span className="text-muted-foreground/70">httpBaseUrl:</span> {record.httpBaseUrl ?? "null"}</div>
      <div><span className="text-muted-foreground/70">wsBaseUrl:</span> {record.wsBaseUrl ?? "null"}</div>
      <div><span className="text-muted-foreground/70">connectionState:</span> {runtimeState?.connectionState ?? "unknown"}</div>
      <div><span className="text-muted-foreground/70">authState:</span> {runtimeState?.authState ?? "unknown"}</div>
      <div><span className="text-muted-foreground/70">role:</span> {runtimeState?.role ?? "null"}</div>
      <div><span className="text-muted-foreground/70">connectedAt:</span> {runtimeState?.connectedAt ?? "null"}</div>
      <div><span className="text-muted-foreground/70">disconnectedAt:</span> {runtimeState?.disconnectedAt ?? "null"}</div>
      <div><span className="text-muted-foreground/70">lastError:</span> {runtimeState?.lastError ?? "null"}</div>
      <div><span className="text-muted-foreground/70">sshConfig:</span> {record.user}@{record.host}:{record.port} {record.workspaceRoot}</div>
      <div><span className="text-muted-foreground/70">bearer:</span> {runtimeState?.authState === "authenticated" ? "present" : "missing"}</div>
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
  label,
  host,
  user,
  port,
  workspaceRoot,
  lastConnectedAt,
  connectionState,
  runtimeState,
  record,
  onReconnect,
  onDisconnect,
  onRemove,
  isActing,
}: RemoteEnvironmentRowProps) {
  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  const [showDebug, setShowDebug] = useState(false);

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
            onClick={() => setShowDebug((prev) => !prev)}
          >
            {showDebug ? "Hide Debug" : "Debug"}
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
      {showDebug ? (
        <DebugStateInspector record={record} runtimeState={runtimeState} />
      ) : null}
    </div>
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
        .filter((r): r is SavedRemoteEnvironment & { environmentId: EnvironmentId } =>
          r.environmentId !== null,
        )
        .toSorted((a, b) => a.label.localeCompare(b.label))
        .map((record) => ({
          record,
          connectionState:
            (runtimeById[record.environmentId]?.connectionState as SavedEnvironmentConnectionState) ??
            "disconnected",
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

// ---------- Connection Log Viewer ----------

const LOG_LEVEL_COLORS: Record<ConnectionLogEntry["level"], string> = {
  info: "text-muted-foreground",
  warn: "text-yellow-500",
  error: "text-red-500",
};

function formatLogTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return [
      d.getHours().toString().padStart(2, "0"),
      d.getMinutes().toString().padStart(2, "0"),
      d.getSeconds().toString().padStart(2, "0"),
    ].join(":");
  } catch {
    return "??:??:??";
  }
}

export function ConnectionLogViewer() {
  const entries = useConnectionLogStore((state) => state.entries);
  const clearLog = useConnectionLogStore((state) => state.clear);
  const [filter, setFilter] = useState<"all" | "errors">("all");

  const filteredEntries = useMemo(
    () => (filter === "errors" ? entries.filter((e) => e.level === "error") : entries),
    [entries, filter],
  );

  const handleCopy = useCallback(() => {
    const text = filteredEntries
      .map(
        (e) =>
          `[${formatLogTimestamp(e.timestamp)}] [${e.level}] [${e.source}] ${e.message}`,
      )
      .join("\n");
    void navigator.clipboard.writeText(text);
    toastManager.add({ type: "info", title: "Copied connection log to clipboard" });
  }, [filteredEntries]);

  return (
    <SettingsSection title="Connection Log">
      <div className="px-4 py-3 sm:px-5">
        <div className="mb-2 flex items-center gap-2">
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
          <Button size="xs" variant="outline" onClick={handleCopy}>
            Copy
          </Button>
          <Button size="xs" variant="outline" onClick={clearLog}>
            Clear
          </Button>
        </div>
        <div className="max-h-[300px] overflow-y-auto rounded border border-border/40 bg-muted/20 p-2 font-mono text-[11px]">
          {filteredEntries.length === 0 ? (
            <p className="text-muted-foreground/60">No log entries.</p>
          ) : (
            filteredEntries.map((entry) => (
              <div key={entry.id} className={`${LOG_LEVEL_COLORS[entry.level]} leading-relaxed`}>
                <span className="text-muted-foreground/60">[{formatLogTimestamp(entry.timestamp)}]</span>{" "}
                <span className="font-semibold">[{entry.level}]</span>{" "}
                <span className="text-muted-foreground/80">[{entry.source}]</span>{" "}
                {entry.message}
              </div>
            ))
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
