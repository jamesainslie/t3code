import { memo, useState } from "react";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { SavedEnvironmentConnectionState } from "~/environments/runtime/catalog";
import type { ConnectionErrorCategory } from "~/lib/connectionErrorClassifier";

export interface SidebarConnectionDetailProps {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly user: string;
  readonly host: string;
  readonly workspaceRoot: string;
  readonly connectedAt: string | null;
  readonly errorCategory: ConnectionErrorCategory | null;
  readonly errorGuidance: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly onReconnect: () => void;
  readonly onDisconnect: () => void;
}

const ERROR_HEADLINES: Record<ConnectionErrorCategory, string> = {
  "tunnel-closed": "Connection lost",
  "auth-expired": "Session expired",
  "server-unreachable": "Server unreachable",
  "network-error": "Network error",
};

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getActionLabel(
  connectionState: SavedEnvironmentConnectionState,
  errorCategory: ConnectionErrorCategory | null,
): string {
  if (connectionState === "error" && errorCategory === "auth-expired") {
    return "Re-pair";
  }
  if (connectionState === "error") {
    return "Reconnect";
  }
  return "Connect";
}

const ConnectedView = memo(function ConnectedView({
  user,
  host,
  workspaceRoot,
  connectedAt,
  onDisconnect,
}: Pick<
  SidebarConnectionDetailProps,
  "user" | "host" | "workspaceRoot" | "connectedAt" | "onDisconnect"
>) {
  return (
    <div className="space-y-2 rounded-md bg-accent/30 px-3 py-2.5">
      <div className="space-y-0.5">
        <p className="font-mono text-xs text-foreground">
          {user}@{host}
        </p>
        <p className="truncate text-xs text-muted-foreground">{workspaceRoot}</p>
        {connectedAt && (
          <p className="text-xs text-muted-foreground">
            Connected {formatRelativeTime(connectedAt)}
          </p>
        )}
      </div>
      <Button
        data-testid="disconnect-button"
        variant="outline"
        size="xs"
        onClick={onDisconnect}
      >
        Disconnect
      </Button>
    </div>
  );
});

const ErrorView = memo(function ErrorView({
  user,
  host,
  errorCategory,
  errorGuidance,
  lastError,
  lastErrorAt,
  onReconnect,
}: Pick<
  SidebarConnectionDetailProps,
  | "user"
  | "host"
  | "errorCategory"
  | "errorGuidance"
  | "lastError"
  | "lastErrorAt"
  | "onReconnect"
>) {
  const [showDetails, setShowDetails] = useState(false);

  const headline = errorCategory ? ERROR_HEADLINES[errorCategory] : "Error";
  const actionLabel = getActionLabel("error", errorCategory);

  return (
    <div className="space-y-2 rounded-md bg-destructive/5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-medium text-destructive">{headline}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {user}@{host}
          </p>
          {errorGuidance && (
            <p className="text-xs text-muted-foreground">{errorGuidance}</p>
          )}
          {lastErrorAt && (
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(lastErrorAt)}
            </p>
          )}
        </div>
      </div>

      {lastError && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowDetails((prev) => !prev)}
          >
            <ChevronRightIcon
              className={`size-3 transition-transform ${showDetails ? "rotate-90" : ""}`}
            />
            Technical details
          </button>
          {showDetails && (
            <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/50 p-2 font-mono text-xs text-muted-foreground">
              {lastError}
            </pre>
          )}
        </div>
      )}

      <Button
        data-testid="action-button"
        variant="outline"
        size="xs"
        onClick={onReconnect}
      >
        {actionLabel}
      </Button>
    </div>
  );
});

const DisconnectedView = memo(function DisconnectedView({
  user,
  host,
  workspaceRoot,
  onReconnect,
}: Pick<
  SidebarConnectionDetailProps,
  "user" | "host" | "workspaceRoot" | "onReconnect"
>) {
  return (
    <div className="space-y-2 rounded-md bg-accent/30 px-3 py-2.5">
      <div className="space-y-0.5">
        <p className="font-mono text-xs text-foreground">
          {user}@{host}
        </p>
        <p className="truncate text-xs text-muted-foreground">{workspaceRoot}</p>
      </div>
      <Button
        data-testid="action-button"
        variant="outline"
        size="xs"
        onClick={onReconnect}
      >
        Connect
      </Button>
    </div>
  );
});

export const SidebarConnectionDetail = memo(function SidebarConnectionDetail({
  connectionState,
  user,
  host,
  workspaceRoot,
  connectedAt,
  errorCategory,
  errorGuidance,
  lastError,
  lastErrorAt,
  onReconnect,
  onDisconnect,
}: SidebarConnectionDetailProps) {
  if (connectionState === "connected") {
    return (
      <ConnectedView
        user={user}
        host={host}
        workspaceRoot={workspaceRoot}
        connectedAt={connectedAt}
        onDisconnect={onDisconnect}
      />
    );
  }

  if (connectionState === "error" && errorCategory) {
    return (
      <ErrorView
        user={user}
        host={host}
        errorCategory={errorCategory}
        errorGuidance={errorGuidance}
        lastError={lastError}
        lastErrorAt={lastErrorAt}
        onReconnect={onReconnect}
      />
    );
  }

  return (
    <DisconnectedView
      user={user}
      host={host}
      workspaceRoot={workspaceRoot}
      onReconnect={onReconnect}
    />
  );
});
