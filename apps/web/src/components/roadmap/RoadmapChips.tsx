import type {
  RoadmapArea,
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
} from "./roadmapPage.logic";

// Eight types need eight hues and the theme declares only a few, so each type
// carries its own; the label badge mixes it into surfaces that suit both themes.
const TYPE_TAGS: Readonly<
  Record<RoadmapItemType, { readonly label: string; readonly hue: string }>
> = {
  objective: { label: "OBJ", hue: "#f472b6" },
  "key-result": { label: "KR", hue: "#22d3ee" },
  initiative: { label: "INIT", hue: "#fb923c" },
  epic: { label: "EPIC", hue: "#a78bfa" },
  feature: { label: "FEAT", hue: "#3b82f6" },
  story: { label: "STORY", hue: "#34d399" },
  bug: { label: "BUG", hue: "#f87171" },
  "support-ticket": { label: "SUPPORT", hue: "#fbbf24" },
};

export function RoadmapTypeTag({ type }: { readonly type: RoadmapItemType }) {
  const tag = TYPE_TAGS[type];
  return (
    <Badge size="sm" variant="label" style={{ "--label": tag.hue } as CSSProperties}>
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

export function RoadmapNeedsReviewBadge() {
  return (
    <Badge size="sm" variant="info">
      Needs review
    </Badge>
  );
}
