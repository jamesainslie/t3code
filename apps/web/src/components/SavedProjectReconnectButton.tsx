import { useCallback, useMemo, useState } from "react";
import type { EnvironmentId, ProjectId, SavedProjectKey } from "@t3tools/contracts";

import {
  reconnectSavedProject,
  useSavedEnvironmentRegistryStore,
  useSavedProjectRegistryStore,
} from "../environments/runtime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";
import { computeSavedProjectReconnectButtonModel } from "./SavedProjectReconnectButton.logic";

export interface SavedProjectReconnectButtonProps {
  readonly savedProjectKey: SavedProjectKey;
  readonly onReconnected?: (result: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) => void;
  readonly className?: string;
}

/**
 * Small pill-shaped "Reconnect" button rendered next to a stale saved project
 * in the sidebar. Wraps {@link reconnectSavedProject} with local busy state
 * and surfaces failures via the global toast manager.
 */
export function SavedProjectReconnectButton(props: SavedProjectReconnectButtonProps) {
  const { savedProjectKey, onReconnected, className } = props;
  const savedProject = useSavedProjectRegistryStore(
    (state) => state.byKey[savedProjectKey] ?? null,
  );
  const savedEnvironment = useSavedEnvironmentRegistryStore((state) =>
    savedProject ? (state.byIdentityKey[savedProject.environmentIdentityKey] ?? null) : null,
  );
  const [busy, setBusy] = useState(false);

  const model = useMemo(
    () =>
      computeSavedProjectReconnectButtonModel({
        savedProject,
        savedEnvironment,
        busy,
      }),
    [savedProject, savedEnvironment, busy],
  );

  const handleClick = useCallback(async () => {
    if (model.disabled) return;
    setBusy(true);
    try {
      const result = await reconnectSavedProject(savedProjectKey);
      onReconnected?.(result);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Reconnect failed",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [model.disabled, onReconnected, savedProjectKey]);

  const button = (
    <button
      type="button"
      disabled={model.disabled}
      onClick={handleClick}
      aria-label={model.tooltip || model.label}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        "text-[10px] font-medium leading-none tracking-wide",
        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        "transition-colors duration-150",
        "hover:bg-amber-500/20 disabled:cursor-default disabled:opacity-60",
        className ?? "",
      ].join(" ")}
    >
      {model.state === "pending" ? (
        <span
          className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      <span>{model.label}</span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger delay={300}>{button}</TooltipTrigger>
      <TooltipPopup side="top" sideOffset={4}>
        {model.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
