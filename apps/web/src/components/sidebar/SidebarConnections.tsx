import { memo, useCallback, useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { EnvironmentId, SavedRemoteEnvironment } from "@t3tools/contracts";

import {
  disconnectSavedEnvironment,
  reconnectSavedEnvironment,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
  type SavedEnvironmentConnectionState,
  type SavedEnvironmentRuntimeState,
} from "~/environments/runtime";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "~/components/ui/collapsible";
import { SidebarGroup } from "~/components/ui/sidebar";
import { toastManager } from "~/components/ui/toast";
import { SidebarConnectionRow } from "./SidebarConnectionRow";
import { SidebarConnectionDetail } from "./SidebarConnectionDetail";

function isRemoteEnvironment(record: SavedRemoteEnvironment): boolean {
  return record.host !== "" && record.user !== "unknown";
}

function buildLabel(record: SavedRemoteEnvironment): string {
  return record.label || `${record.user}@${record.host}`;
}

function connectionStateForEnvironment(
  record: SavedRemoteEnvironment,
  runtimeById: Readonly<Record<EnvironmentId, SavedEnvironmentRuntimeState>>,
): SavedEnvironmentConnectionState {
  if (!record.environmentId) return "disconnected";
  return runtimeById[record.environmentId]?.connectionState ?? "disconnected";
}

function runtimeForEnvironment(
  record: SavedRemoteEnvironment,
  runtimeById: Readonly<Record<EnvironmentId, SavedEnvironmentRuntimeState>>,
): SavedEnvironmentRuntimeState | null {
  if (!record.environmentId) return null;
  return runtimeById[record.environmentId] ?? null;
}

interface BadgeCounts {
  readonly connected: number;
  readonly errored: number;
}

function computeBadgeCounts(
  records: ReadonlyArray<SavedRemoteEnvironment>,
  runtimeById: Readonly<Record<EnvironmentId, SavedEnvironmentRuntimeState>>,
): BadgeCounts {
  let connected = 0;
  let errored = 0;
  for (const record of records) {
    const state = connectionStateForEnvironment(record, runtimeById);
    if (state === "connected") connected += 1;
    if (state === "error") errored += 1;
  }
  return { connected, errored };
}

export const SidebarConnections = memo(function SidebarConnections() {
  const records = useSavedEnvironmentRegistryStore(
    useShallow((state) => Object.values(state.byIdentityKey)),
  );
  const runtimeById = useSavedEnvironmentRuntimeStore(useShallow((state) => state.byId));

  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  const remotes = useMemo(() => records.filter(isRemoteEnvironment), [records]);

  const badgeCounts = useMemo(
    () => computeBadgeCounts(remotes, runtimeById),
    [remotes, runtimeById],
  );

  const handleToggleExpand = useCallback(
    (identityKey: string) => {
      setExpandedRowId((prev) => (prev === identityKey ? null : identityKey));
    },
    [],
  );

  const handleReconnect = useCallback(async (environmentId: EnvironmentId) => {
    try {
      await reconnectSavedEnvironment(environmentId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Reconnect failed",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleDisconnect = useCallback(async (environmentId: EnvironmentId) => {
    await disconnectSavedEnvironment(environmentId);
  }, []);

  if (remotes.length === 0) {
    return null;
  }

  const badgeText =
    !sectionOpen && (badgeCounts.connected > 0 || badgeCounts.errored > 0)
      ? `(${badgeCounts.connected > 0 ? `${badgeCounts.connected} \u{1F7E2}` : ""}${badgeCounts.connected > 0 && badgeCounts.errored > 0 ? " " : ""}${badgeCounts.errored > 0 ? `${badgeCounts.errored} \u{1F534}` : ""})`
      : null;

  return (
    <SidebarGroup className="px-2 py-2">
      <Collapsible open={sectionOpen} onOpenChange={setSectionOpen}>
        <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
          <CollapsibleTrigger className="flex items-center gap-1">
            <ChevronRightIcon
              className={`size-3 text-muted-foreground/60 transition-transform duration-150 ${sectionOpen ? "rotate-90" : ""}`}
            />
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Connections
            </span>
            {badgeText && (
              <span className="ml-1 text-[10px] text-muted-foreground/60">{badgeText}</span>
            )}
          </CollapsibleTrigger>
          <button
            type="button"
            aria-label="Add connection"
            className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
        <CollapsiblePanel>
          <div className="space-y-0.5">
            {remotes.map((record) => {
              const state = connectionStateForEnvironment(record, runtimeById);
              const runtime = runtimeForEnvironment(record, runtimeById);
              const isExpanded = expandedRowId === record.identityKey;

              return (
                <div key={record.identityKey}>
                  <SidebarConnectionRow
                    label={buildLabel(record)}
                    connectionState={state}
                    errorCategory={runtime?.errorCategory ?? null}
                    isExpanded={isExpanded}
                    onToggleExpand={() => handleToggleExpand(record.identityKey)}
                    onReconnect={() => {
                      if (record.environmentId) {
                        void handleReconnect(record.environmentId);
                      }
                    }}
                  />
                  {isExpanded && (
                    <SidebarConnectionDetail
                      connectionState={state}
                      user={record.user}
                      host={record.host}
                      workspaceRoot={record.workspaceRoot}
                      connectedAt={runtime?.connectedAt ?? null}
                      errorCategory={runtime?.errorCategory ?? null}
                      errorGuidance={runtime?.errorGuidance ?? null}
                      lastError={runtime?.lastError ?? null}
                      lastErrorAt={runtime?.lastErrorAt ?? null}
                      onReconnect={() => {
                        if (record.environmentId) {
                          void handleReconnect(record.environmentId);
                        }
                      }}
                      onDisconnect={() => {
                        if (record.environmentId) {
                          void handleDisconnect(record.environmentId);
                        }
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </SidebarGroup>
  );
});
