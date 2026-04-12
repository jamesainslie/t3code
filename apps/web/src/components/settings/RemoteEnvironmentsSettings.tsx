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
  readonly onReconnect: (environmentId: EnvironmentId) => void;
  readonly onDisconnect: (environmentId: EnvironmentId) => void;
  readonly onRemove: (environmentId: EnvironmentId) => void;
  readonly isActing: boolean;
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
  onReconnect,
  onDisconnect,
  onRemove,
  isActing,
}: RemoteEnvironmentRowProps) {
  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

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
    </div>
  );
}

// ---------- Pure presentational component (testable with renderToStaticMarkup) ----------

export interface RemoteEnvironmentEntry {
  readonly record: SavedRemoteEnvironment;
  readonly connectionState: SavedEnvironmentConnectionState;
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
      {entries.map(({ record, connectionState }) => (
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
