/**
 * Fork: roadmap. Pure helpers for the Timeline tab: the item metrics the
 * layout needs, the rows the view draws, and every pixel position, so the
 * component only places what these return.
 */
import type {
  IsoDate,
  RoadmapArea,
  RoadmapAreaSettings,
  RoadmapItemId,
  RoadmapSprint,
  RoadmapWorkItem,
} from "@lathe/contracts";
import type {
  RoadmapTimelineLayout,
  RoadmapTimelineRange,
  RoadmapTimelineRow,
  RoadmapTimelineSprintBand,
} from "@lathe/client-runtime/roadmap/timeline";
import { effectiveArea } from "@lathe/shared/roadmap";
import {
  addDays,
  burned,
  daysBetween,
  forecast,
  isWorkingDay,
  type RoadmapDateOf,
  type RoadmapForecast,
  type RoadmapForecastStatus,
  type RoadmapItemsById,
  type RoadmapVelocity,
  totalUnits,
  velocity,
} from "@lathe/shared/roadmapCalc";

/** Weeks scale: a week is 112px, wide enough for an "Oct 12" tick label. */
export const TIMELINE_DAY_WIDTH = 16;
/** Matches the `h-9` rows the view draws; blocker lines are placed with it. */
export const TIMELINE_ROW_HEIGHT = 36;
const MIN_LABEL_WIDTH = 36;
const MIN_EDGE_BEND = 16;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONDAY = [1];

/** "Oct 12". */
export function timelineDateLabel(date: IsoDate): string {
  const [, month, day] = date.split("-").map(Number);
  return `${MONTH_NAMES[month! - 1]} ${day}`;
}

export interface TimelineTick {
  readonly offset: number;
  readonly label: string;
}

export function timelineWeekTicks(range: RoadmapTimelineRange): ReadonlyArray<TimelineTick> {
  let first = range.start;
  while (!isWorkingDay(first, MONDAY)) first = addDays(first, 1);
  const ticks: TimelineTick[] = [];
  for (let date = first; date <= range.end; date = addDays(date, 7)) {
    ticks.push({ offset: daysBetween(range.start, date), label: timelineDateLabel(date) });
  }
  return ticks;
}

export interface TimelineSpan {
  readonly left: number;
  readonly width: number;
}

/** Days `start` to `end`, both inclusive, clipped to the range; null when wholly outside it. */
export function timelineSpan(start: number, end: number, days: number): TimelineSpan | null {
  const from = Math.max(0, start);
  const to = Math.min(days - 1, end);
  if (to < from) return null;
  return { left: from * TIMELINE_DAY_WIDTH, width: (to - from + 1) * TIMELINE_DAY_WIDTH };
}

export function timelineTodayX(todayOffset: number): number {
  return todayOffset * TIMELINE_DAY_WIDTH + TIMELINE_DAY_WIDTH / 2;
}

/** The sprint running today, which the lanes shade to set it apart from the others. */
export function timelineCurrentSprint(
  bands: ReadonlyArray<RoadmapTimelineSprintBand>,
  todayOffset: number | null,
): RoadmapTimelineSprintBand["sprintId"] | null {
  if (todayOffset === null) return null;
  return (
    bands.find((band) => band.start <= todayOffset && todayOffset <= band.end)?.sprintId ?? null
  );
}

const FORECAST_LABELS: Readonly<Record<RoadmapForecastStatus, string>> = {
  "on-track": "on track",
  "at-risk": "at risk",
  late: "late",
  "no-forecast": "no forecast",
};

const percent = (progress: number) => `${Math.round(progress * 100)}%`;

export interface TimelineBarGeometry {
  readonly bar: TimelineSpan | null;
  /** The right edge of the due day, since an item is due by the end of it. */
  readonly dueX: number | null;
  readonly forecast:
    | (TimelineSpan & {
        readonly status: RoadmapForecastStatus;
        readonly label: string | null;
      })
    | null;
  /** The progress percentage, when there is progress and the bar has room for it. */
  readonly label: string | null;
  /** Width of the done part from the bar's left edge, null without progress. */
  readonly fill: number | null;
}

export function timelineBarGeometry(row: RoadmapTimelineRow, days: number): TimelineBarGeometry {
  const bar = timelineSpan(row.start, row.end, days);
  const extension =
    row.forecast === null || row.due === null
      ? null
      : timelineSpan(row.due + 1, row.forecast.end, days);
  return {
    bar,
    dueX:
      row.due === null || row.due < 0 || row.due >= days
        ? null
        : (row.due + 1) * TIMELINE_DAY_WIDTH,
    forecast:
      extension === null || row.forecast === null
        ? null
        : {
            ...extension,
            status: row.forecast.status,
            label: extension.width < MIN_LABEL_WIDTH ? null : FORECAST_LABELS[row.forecast.status],
          },
    label:
      row.progress === null || bar === null || bar.width < MIN_LABEL_WIDTH
        ? null
        : percent(row.progress),
    fill: row.progress === null || bar === null ? null : progressFill(row, row.progress, bar),
  };
}

// Progress runs along the item's whole span, so a bar the range cuts shows only
// the done part that falls inside it.
function progressFill(row: RoadmapTimelineRow, progress: number, bar: TimelineSpan): number {
  const spanStart = row.start * TIMELINE_DAY_WIDTH;
  const spanWidth = (row.end - row.start + 1) * TIMELINE_DAY_WIDTH;
  const doneEnd = spanStart + Math.min(1, Math.max(0, progress)) * spanWidth;
  return Math.min(bar.width, Math.max(0, doneEnd - bar.left));
}

/** The hover text and accessible name of a bar, since narrow bars have no room for labels. */
export function timelineBarTitle(
  title: string,
  row: RoadmapTimelineRow,
  range: RoadmapTimelineRange,
): string {
  const label = (offset: number) => timelineDateLabel(addDays(range.start, offset));
  const parts = [
    title,
    row.start === row.end ? label(row.start) : `${label(row.start)} to ${label(row.end)}`,
  ];
  if (row.due !== null && row.due !== row.end) parts.push(`due ${label(row.due)}`);
  if (row.forecast !== null) {
    parts.push(`forecast ${label(row.forecast.end)}`, FORECAST_LABELS[row.forecast.status]);
  }
  if (row.done) parts.push("done");
  else if (row.progress !== null) parts.push(`${percent(row.progress)} done`);
  return parts.join(", ");
}

export type TimelineDisplayRow =
  | {
      readonly kind: "group";
      readonly groupId: RoadmapItemId;
      readonly title: string;
    }
  | {
      readonly kind: "item";
      /** Index into the layout's rows. */
      readonly row: number;
      /** The group's root, drawn as the group's heading. */
      readonly groupHead: boolean;
    };

/**
 * The layout's rows with a heading for each group. A group root with dates is
 * its own heading; one without dates gets a label-only row, so its children
 * never appear orphaned.
 */
export function timelineDisplayRows(layout: RoadmapTimelineLayout): {
  readonly rows: ReadonlyArray<TimelineDisplayRow>;
  /** Display row of each layout row, for placing blocker lines. */
  readonly displayIndexOf: ReadonlyArray<number>;
} {
  const rows: TimelineDisplayRow[] = [];
  const displayIndexOf: number[] = [];
  for (const group of layout.groups) {
    if (layout.rows[group.firstRow]?.itemId !== group.rootId) {
      rows.push({ kind: "group", groupId: group.rootId, title: group.title });
    }
    for (let index = group.firstRow; index < group.firstRow + group.rowCount; index += 1) {
      displayIndexOf[index] = rows.length;
      rows.push({
        kind: "item",
        row: index,
        groupHead: layout.rows[index]?.itemId === group.rootId,
      });
    }
  }
  return { rows, displayIndexOf };
}

export interface TimelineEdgePath {
  readonly key: string;
  readonly d: string;
}

/**
 * One curve per blocker, from the end of the blocker's bar to the start of the
 * bar it holds up. The bend has a floor so overlapping bars still read as a
 * link rather than a stray vertical stroke.
 */
export function timelineEdgePaths(
  layout: RoadmapTimelineLayout,
  displayIndexOf: ReadonlyArray<number>,
): ReadonlyArray<TimelineEdgePath> {
  const width = layout.days * TIMELINE_DAY_WIDTH;
  const clampX = (x: number) => Math.min(width, Math.max(0, x));
  const centerY = (display: number) => display * TIMELINE_ROW_HEIGHT + TIMELINE_ROW_HEIGHT / 2;
  const paths: TimelineEdgePath[] = [];
  for (const edge of layout.edges) {
    const from = layout.rows[edge.from];
    const to = layout.rows[edge.to];
    const fromDisplay = displayIndexOf[edge.from];
    const toDisplay = displayIndexOf[edge.to];
    if (from === undefined || to === undefined) continue;
    if (fromDisplay === undefined || toDisplay === undefined) continue;
    const x1 = clampX((from.end + 1) * TIMELINE_DAY_WIDTH);
    const x2 = clampX(to.start * TIMELINE_DAY_WIDTH);
    const y1 = centerY(fromDisplay);
    const y2 = centerY(toDisplay);
    const bend = Math.max(MIN_EDGE_BEND, Math.abs(x2 - x1) / 2);
    paths.push({
      key: `${edge.from}-${edge.to}`,
      d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`,
    });
  }
  return paths;
}

export function hiddenWithoutDatesNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 item has no dates" : `${count} items have no dates`;
}

export interface TimelineMetrics {
  readonly forecasts: ReadonlyMap<RoadmapItemId, RoadmapForecast>;
  /** Burned over total, 0 to 1; absent when the item has nothing to burn against. */
  readonly progress: ReadonlyMap<RoadmapItemId, number>;
}

/**
 * Forecast and progress for every item, each in its area's unit. Velocity is
 * computed once per area and sprint mode, as Today does, so the cost stays
 * linear in the number of items.
 */
export function timelineMetrics(input: {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly today: IsoDate;
  readonly areaSettings: Readonly<Record<RoadmapArea, RoadmapAreaSettings>>;
  readonly dateOf: RoadmapDateOf;
}): TimelineMetrics {
  const { items, sprints, today, areaSettings, dateOf } = input;
  const byId: RoadmapItemsById = new Map(items.map((entry) => [entry.id, entry]));
  const velocities = new Map<string, RoadmapVelocity | null>();
  const velocityFor = (area: RoadmapArea, useSprints: boolean) => {
    const key = `${area}:${useSprints}`;
    if (!velocities.has(key)) {
      velocities.set(
        key,
        velocity({ items, area, settings: areaSettings[area], today, sprints, useSprints, dateOf }),
      );
    }
    return velocities.get(key) ?? null;
  };

  const forecasts = new Map<RoadmapItemId, RoadmapForecast>();
  const progress = new Map<RoadmapItemId, number>();
  for (const item of items) {
    const area = effectiveArea(item.id, byId).area;
    const settings = areaSettings[area];
    forecasts.set(
      item.id,
      forecast({
        item,
        byId,
        unit: settings.unit,
        velocity: velocityFor(area, item.sprintId !== null),
        today,
        weekdays: settings.workingWeekdays,
      }),
    );
    if (item.state === "done") {
      progress.set(item.id, 1);
      continue;
    }
    const total = totalUnits(item, byId, settings.unit);
    if (total === null || total <= 0) continue;
    progress.set(item.id, Math.min(1, burned(item, byId, settings.unit) / total));
  }
  return { forecasts, progress };
}
