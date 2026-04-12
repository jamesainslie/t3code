import type { MetricState } from "@t3tools/contracts";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";

// ─── Props ──────────────────────────────────────────────────────────

export interface ResourceMetricRowProps {
  label: string;
  state: MetricState;
  summary: string;
  icon?: LucideIcon;
  usagePercent?: number;
  defaultExpanded?: boolean;
  children?: React.ReactNode;
}

// ─── State → Color Mapping ──────────────────────────────────────────

const stateDotColor: Record<MetricState, string> = {
  normal: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-red-500",
};

const stateBarColor: Record<MetricState, string> = {
  normal: "bg-muted-foreground/30",
  warn: "bg-amber-500",
  critical: "bg-red-500",
};

// ─── Component ──────────────────────────────────────────────────────

export function ResourceMetricRow({
  label,
  state,
  summary,
  icon: Icon,
  usagePercent,
  defaultExpanded = false,
  children,
}: ResourceMetricRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="px-3 py-2">
      {/* Header line */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={cn("size-2 shrink-0 rounded-full", stateDotColor[state])}
          aria-hidden="true"
        />
        {Icon && (
          <Icon
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="text-foreground">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {summary}
        </span>
      </div>

      {/* Usage bar */}
      {usagePercent != null && (
        <div className="mt-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", stateBarColor[state])}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
              role="progressbar"
              aria-valuenow={usagePercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${label} usage`}
            />
          </div>
        </div>
      )}

      {/* Expandable detail */}
      {children && (
        <>
          <button
            type="button"
            className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((prev) => !prev)}
          >
            <span aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
            <span>Details</span>
          </button>
          {expanded && (
            <div className="mt-1 space-y-0.5 pl-4 text-xs">{children}</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Detail Key-Value Row ───────────────────────────────────────────

export function DetailKV({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
