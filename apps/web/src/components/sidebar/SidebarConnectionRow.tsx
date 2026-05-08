import { memo } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { SavedEnvironmentConnectionState } from "~/environments/runtime/catalog";
import type { ConnectionErrorCategory } from "~/lib/connectionErrorClassifier";

export interface SidebarConnectionRowProps {
  readonly label: string;
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly errorCategory: ConnectionErrorCategory | null;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onReconnect: () => void;
}

const STATE_LABELS: Record<SavedEnvironmentConnectionState, string> = {
  connected: "Connected",
  connecting: "Reconnecting\u2026",
  disconnected: "Disconnected",
  error: "Error",
};

const DOT_CLASSES: Record<SavedEnvironmentConnectionState, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  disconnected: "bg-gray-400",
  error: "bg-red-500",
};

function showReconnectButton(state: SavedEnvironmentConnectionState): boolean {
  return state === "error" || state === "disconnected";
}

export const SidebarConnectionRow = memo(function SidebarConnectionRow({
  label,
  connectionState,
  errorCategory: _errorCategory,
  isExpanded: _isExpanded,
  onToggleExpand,
  onReconnect,
}: SidebarConnectionRowProps) {
  return (
    <div
      className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer"
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpand();
        }
      }}
    >
      {/* Status dot */}
      <span
        className={`inline-block size-2 shrink-0 rounded-full ${DOT_CLASSES[connectionState]}`}
        aria-hidden="true"
      />

      {/* Hostname label */}
      <span className="min-w-0 flex-1 truncate font-mono text-xs">{label}</span>

      {/* State text */}
      <span className="shrink-0 text-xs text-muted-foreground">
        {STATE_LABELS[connectionState]}
      </span>

      {/* Reconnect button */}
      {showReconnectButton(connectionState) && (
        <button
          type="button"
          data-testid="reconnect-button"
          className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Reconnect"
          onClick={(e) => {
            e.stopPropagation();
            onReconnect();
          }}
        >
          <RefreshCwIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
});
