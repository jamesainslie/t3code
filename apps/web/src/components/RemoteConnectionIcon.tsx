import { CloudIcon, CloudOffIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";

type ConnectionState = "connected" | "connecting" | "disconnected" | "error";

interface RemoteConnectionIconProps {
  state: ConnectionState | null;
  tooltip?: string;
  onClick?: () => void;
}

export function RemoteConnectionIcon({ state, tooltip, onClick }: RemoteConnectionIconProps) {
  if (!state) return null;

  const icon = (() => {
    switch (state) {
      case "connected":
        return <CloudIcon className="size-3.5 text-emerald-500" />;
      case "connecting":
        return <CloudIcon className="size-3.5 text-muted-foreground animate-pulse" />;
      case "disconnected":
        return <CloudOffIcon className="size-3.5 text-muted-foreground" />;
      case "error":
        return <CloudOffIcon className="size-3.5 text-red-500" />;
    }
  })();

  const clickable = state === "disconnected" || state === "error";

  const element = (
    <button
      type="button"
      className={clickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}
      onClick={clickable ? onClick : undefined}
      aria-label={`Remote: ${state}`}
    >
      {icon}
    </button>
  );

  if (!tooltip) return element;

  return (
    <Tooltip>
      <TooltipTrigger delay={300}>{element}</TooltipTrigger>
      <TooltipPopup side="right" sideOffset={4}>
        {tooltip}
      </TooltipPopup>
    </Tooltip>
  );
}
