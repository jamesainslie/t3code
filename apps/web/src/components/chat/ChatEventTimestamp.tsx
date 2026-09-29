import type { TimestampFormat } from "@t3tools/contracts/settings";

import {
  type ChatEventTimestampOptions,
  formatChatEventTimestamp,
  formatChatEventTimestampTooltip,
} from "../../chatEventTimestamps";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Always-visible local time for a timeline event, shown when event timestamps
 * are on. `startIso` makes the tooltip describe a span ending at `iso`.
 */
export function ChatEventTimestamp({
  iso,
  startIso,
  timestampFormat,
  options,
  className,
}: {
  iso: string;
  startIso?: string | undefined;
  timestampFormat: TimestampFormat;
  options: ChatEventTimestampOptions;
  className?: string;
}) {
  const label = formatChatEventTimestamp(iso, timestampFormat, options);
  if (!label) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums",
              className,
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipPopup>
        {formatChatEventTimestampTooltip(iso, timestampFormat, startIso)
          .split("\n")
          .map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
      </TooltipPopup>
    </Tooltip>
  );
}
