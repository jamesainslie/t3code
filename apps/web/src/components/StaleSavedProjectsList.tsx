import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId, SavedProjectKey } from "@t3tools/contracts";

import {
  selectSidebarProjectEntries,
  useSavedEnvironmentRegistryStore,
  useSavedProjectRegistryStore,
} from "../environments/runtime";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { SavedProjectReconnectButton } from "./SavedProjectReconnectButton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Renders a compact "Disconnected projects" section listing saved remote
 * projects whose parent environment is not currently loaded in the live
 * read-model. Each row shows a per-project Reconnect button.
 *
 * The list is intentionally kept independent from the main sidebar project
 * rendering because stale entries cannot participate in cross-environment
 * grouping, thread expansion, or drag-to-reorder.
 */
export function StaleSavedProjectsList(props: {
  readonly onReconnected?: (result: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) => void;
}) {
  const setActiveEnvironmentId = useStore((state) => state.setActiveEnvironmentId);
  const navigate = useNavigate();

  const defaultOnReconnected = useCallback(
    (result: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId }) => {
      setActiveEnvironmentId(result.environmentId);
      void navigate({ to: "/" }).catch(() => undefined);
    },
    [setActiveEnvironmentId, navigate],
  );
  const onReconnected = props.onReconnected ?? defaultOnReconnected;
  const liveProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const savedProjects = useSavedProjectRegistryStore(
    useShallow((state) => Object.values(state.byKey)),
  );
  const identityKeyByEnvironmentId = useSavedEnvironmentRegistryStore(
    (state) => state.identityKeyByEnvironmentId,
  );

  const staleEntries = useMemo(
    () =>
      selectSidebarProjectEntries({
        liveProjects,
        savedProjects,
        identityKeyByEnvironmentId,
      }).filter((entry) => entry.isStale),
    [liveProjects, savedProjects, identityKeyByEnvironmentId],
  );

  if (staleEntries.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border/30 pt-2 pb-1">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Disconnected
      </div>
      <ul className="flex flex-col">
        {staleEntries.map((entry) => (
          <li
            key={entry.key}
            className="group flex items-center justify-between gap-2 px-3 py-1.5 opacity-60 transition-opacity hover:opacity-100"
          >
            <Tooltip>
              <TooltipTrigger delay={300}>
                <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
              </TooltipTrigger>
              <TooltipPopup side="right" sideOffset={8}>
                {entry.workspaceRoot}
              </TooltipPopup>
            </Tooltip>
            <SavedProjectReconnectButton
              savedProjectKey={entry.key as SavedProjectKey}
              onReconnected={onReconnected}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
