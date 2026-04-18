import { MonitorIcon } from "lucide-react";

import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

/**
 * Presence indicator for projects whose workspace lives on this machine.
 * Mirrors the visual convention established by RemoteConnectionIcon (cloud
 * for remote) and BranchToolbarEnvironmentSelector (monitor for primary
 * environment). Local projects don't have a connection state — if the app
 * is running, local is by definition reachable — so this component is
 * purely decorative and doesn't accept click handlers.
 */
export function LocalPresenceIcon({ tooltip = "Local" }: { tooltip?: string } = {}) {
  const icon = (
    <span
      aria-label="Local project"
      className="inline-flex items-center justify-center text-muted-foreground/60"
    >
      <MonitorIcon className="size-3.5" />
    </span>
  );

  if (!tooltip) return icon;

  return (
    <Tooltip>
      <TooltipTrigger delay={300}>{icon}</TooltipTrigger>
      <TooltipPopup side="right" sideOffset={4}>
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
