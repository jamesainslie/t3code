import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { EnvironmentId } from "@t3tools/contracts";

import {
  reconnectSavedEnvironment,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { toastManager } from "./ui/toast";
import {
  computeRemotePillModel,
  type RemotePillState,
} from "./SidebarRemoteReconnectPill.logic";

/**
 * Tailwind color classes for each pill state. The halo uses `animate-ping`
 * (Tailwind's built-in pulse) scaled with opacity so it reads as a soft
 * heartbeat rather than a flicker.
 */
const STATE_STYLES: Record<
  Exclude<RemotePillState, "hidden">,
  {
    readonly halo: string;
    readonly dot: string;
    readonly text: string;
    readonly border: string;
    readonly pulse: boolean;
  }
> = {
  connected: {
    halo: "bg-emerald-400/70",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
    pulse: true,
  },
  connecting: {
    halo: "bg-sky-400/70",
    dot: "bg-sky-500",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-500/30 bg-sky-500/5",
    pulse: true,
  },
  reconnect: {
    halo: "bg-amber-400/80",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20",
    pulse: true,
  },
  error: {
    halo: "bg-rose-400/80",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20",
    pulse: true,
  },
};

export function SidebarRemoteReconnectPill() {
  const records = useSavedEnvironmentRegistryStore(
    useShallow((state) => Object.values(state.byIdentityKey)),
  );
  const runtimeById = useSavedEnvironmentRuntimeStore(
    useShallow((state) => state.byId),
  );
  const [busy, setBusy] = useState(false);

  const model = useMemo(
    () => computeRemotePillModel({ records, runtimeById }),
    [records, runtimeById],
  );

  const handleClick = useCallback(async () => {
    if (model.reconnectTargets.length === 0 || busy) return;
    setBusy(true);
    const failures: Array<{ id: EnvironmentId; message: string }> = [];
    try {
      for (const environmentId of model.reconnectTargets) {
        try {
          await reconnectSavedEnvironment(environmentId);
        } catch (error) {
          failures.push({
            id: environmentId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (failures.length > 0) {
        toastManager.add({
          type: "error",
          title:
            failures.length === model.reconnectTargets.length
              ? "Reconnect failed"
              : "Some reconnects failed",
          description: failures.map((f) => f.message).join(" • "),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, model.reconnectTargets]);

  if (model.state === "hidden") {
    return null;
  }

  const styles = STATE_STYLES[model.state];
  const interactive = model.reconnectTargets.length > 0;
  const effectiveLabel = busy ? "Reconnecting…" : model.label;

  const pill = (
    <button
      type="button"
      disabled={!interactive || busy}
      onClick={handleClick}
      aria-label={model.tooltip || effectiveLabel}
      className={[
        "group inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        "text-[11px] font-medium leading-none tracking-wide",
        "transition-colors duration-150",
        "disabled:cursor-default disabled:opacity-90",
        interactive ? "cursor-pointer" : "cursor-default",
        styles.border,
        styles.text,
      ].join(" ")}
    >
      <span className="relative flex h-2 w-2 items-center justify-center">
        {styles.pulse && (
          <span
            className={[
              "absolute inline-flex h-full w-full rounded-full opacity-75",
              "animate-ping",
              styles.halo,
            ].join(" ")}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${styles.dot}`} />
      </span>
      <span className="max-w-[12rem] truncate">{effectiveLabel}</span>
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger delay={300}>{pill}</TooltipTrigger>
      <TooltipPopup side="top" sideOffset={4}>
        {model.tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
