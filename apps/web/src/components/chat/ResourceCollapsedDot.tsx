import { memo } from "react";
import { Activity } from "lucide-react";
import type { HostResourceSnapshot, MetricState } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { worstState } from "~/rpc/hostResourceState";

function getMetricColorClass(state: MetricState): string {
  switch (state) {
    case "normal":
      return "text-muted-foreground/50";
    case "warn":
      return "text-amber-500";
    case "critical":
      return "text-red-500 animate-pulse-slow";
  }
}

export const ResourceCollapsedDot = memo(function ResourceCollapsedDot({
  snapshot,
}: {
  snapshot: HostResourceSnapshot;
}) {
  const state = worstState(snapshot);
  return (
    <span
      aria-label="System resources"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border border-border",
        getMetricColorClass(state),
      )}
    >
      <Activity className="size-3.5" />
    </span>
  );
});
