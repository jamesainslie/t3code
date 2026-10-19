import type {
  RoadmapArea,
  RoadmapIssueSource,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapPriority,
} from "@lathe/contracts";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import {
  ROADMAP_AREA_LABELS,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_STATE_LABELS,
  ROADMAP_TYPE_LABELS,
} from "./roadmap.logic";
import type { RoadmapForecastLabel, RoadmapForecastShownStatus } from "./roadmapPage.logic";

// Eight types need eight hues and the theme declares only a few, so each type
// carries its own; the label badge mixes it into surfaces that suit both themes.
// They share one lightness and chroma so that no type outshouts the others.
const typeHue = (angle: number) => `oklch(0.72 0.15 ${angle})`;
const TYPE_TAGS: Readonly<
  Record<RoadmapItemType, { readonly label: string; readonly hue: string }>
> = {
  objective: { label: "OBJ", hue: typeHue(350) },
  "key-result": { label: "KR", hue: typeHue(205) },
  initiative: { label: "INIT", hue: typeHue(50) },
  epic: { label: "EPIC", hue: typeHue(295) },
  feature: { label: "FEAT", hue: typeHue(255) },
  story: { label: "STORY", hue: typeHue(160) },
  bug: { label: "BUG", hue: typeHue(25) },
  "support-ticket": { label: "SUPPORT", hue: typeHue(85) },
};

/** For surfaces coloured by type beyond the tag itself, such as Timeline bars. */
export function roadmapTypeHue(type: RoadmapItemType): string {
  return TYPE_TAGS[type].hue;
}

export function RoadmapTypeTag({ type }: { readonly type: RoadmapItemType }) {
  const tag = TYPE_TAGS[type];
  return (
    <Badge
      size="sm"
      variant="label"
      style={{ "--label": tag.hue } as CSSProperties}
      aria-label={ROADMAP_TYPE_LABELS[type]}
    >
      {tag.label}
    </Badge>
  );
}

const PRIORITY_TONE: Readonly<Record<RoadmapPriority, string>> = {
  p0: "border-destructive/45 text-destructive-foreground",
  p1: "border-warning/45 text-warning-foreground",
  p2: "border-border text-muted-foreground",
  p3: "border-border/60 text-muted-foreground/70",
};

/** A dashed outline marks a priority inherited from a parent rather than set on the item. */
export function RoadmapPriorityChip({
  priority,
  inherited,
}: {
  readonly priority: RoadmapPriority;
  readonly inherited: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border px-1 text-2xs leading-none font-semibold tabular-nums",
        PRIORITY_TONE[priority],
        inherited && "border-dashed",
      )}
    >
      {ROADMAP_PRIORITY_LABELS[priority]}
    </span>
  );
}

const STATE_VARIANT = {
  backlog: "secondary",
  "in-progress": "info",
  "in-review": "warning",
  done: "success",
} as const satisfies Record<RoadmapItemState, "secondary" | "info" | "warning" | "success">;

export function RoadmapStateChip({ state }: { readonly state: RoadmapItemState }) {
  return (
    <Badge size="sm" variant={STATE_VARIANT[state]}>
      {ROADMAP_STATE_LABELS[state]}
    </Badge>
  );
}

export function RoadmapAreaBadge({ area }: { readonly area: RoadmapArea }) {
  return (
    <Badge size="sm" variant="outline">
      {ROADMAP_AREA_LABELS[area]}
    </Badge>
  );
}

export function RoadmapBlockedBadge() {
  return (
    <Badge size="sm" variant="warning">
      Blocked
    </Badge>
  );
}

/** The GitHub issue an item syncs with, by number; the repository is in its label. */
export function RoadmapIssueChip({ source }: { readonly source: RoadmapIssueSource }) {
  const ref = `${source.owner}/${source.repo}#${source.number}`;
  return (
    <Badge size="sm" variant="outline" aria-label={`GitHub issue ${ref}`} title={ref}>
      #{source.number}
    </Badge>
  );
}

export function RoadmapNeedsReviewBadge() {
  return (
    <Badge size="sm" variant="info">
      Needs review
    </Badge>
  );
}

export function RoadmapFocusBadge() {
  return (
    <Badge size="sm" variant="secondary">
      Focus
    </Badge>
  );
}

export const ROADMAP_FORECAST_TONE: Readonly<Record<RoadmapForecastShownStatus, string>> = {
  "on-track": "text-success-foreground",
  "at-risk": "text-warning-foreground",
  late: "text-destructive-foreground",
};

const FORECAST_VARIANT = {
  "on-track": "success",
  "at-risk": "warning",
  late: "error",
} as const satisfies Record<RoadmapForecastShownStatus, "success" | "warning" | "error">;

export function RoadmapForecastBadge({ forecast }: { readonly forecast: RoadmapForecastLabel }) {
  return (
    <Badge size="sm" variant={FORECAST_VARIANT[forecast.status]}>
      {forecast.text}
    </Badge>
  );
}
