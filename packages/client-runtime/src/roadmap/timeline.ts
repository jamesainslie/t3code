/**
 * Fork: roadmap. The Timeline's layout: rows of bars on a calendar-day axis,
 * blocker edges between rows, sprint bands and the today line. Pure, so the
 * view only positions what this returns.
 */
import type {
  IsoDate,
  RoadmapArea,
  RoadmapItemId,
  RoadmapSprint,
  RoadmapSprintId,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { effectiveArea } from "@lathe/shared/roadmap";
import {
  addDays,
  daysBetween,
  isWorkingDay,
  type RoadmapDateOf,
  type RoadmapForecast,
  type RoadmapForecastStatus,
  utcDateOf,
} from "@lathe/shared/roadmapCalc";

import { buildTree, type RoadmapTreeNode } from "./roadmapTree.ts";

/** Both ends inclusive. */
export interface RoadmapTimelineRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

export interface RoadmapTimelineInput {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly today: IsoDate;
  /** From `roadmapCalc.forecast`, which needs velocity and settings this module does not. */
  readonly forecasts: ReadonlyMap<RoadmapItemId, RoadmapForecast>;
  readonly range: RoadmapTimelineRange;
  /** Null or absent shows both areas. */
  readonly area?: RoadmapArea | null;
  /** Burned over total, 0 to 1, per item. */
  readonly progress?: ReadonlyMap<RoadmapItemId, number>;
  readonly dateOf?: RoadmapDateOf;
}

export interface RoadmapTimelineRow {
  readonly itemId: RoadmapItemId;
  /** The group's root item. */
  readonly groupId: RoadmapItemId;
  /** Levels below the group root. */
  readonly depth: number;
  /** Day offsets from the range start, both inclusive; they may fall outside the range. */
  readonly start: number;
  readonly end: number;
  readonly due: number | null;
  /** The dashed extension from the due date to a later projected date. */
  readonly forecast: { readonly status: RoadmapForecastStatus; readonly end: number } | null;
  readonly progress: number | null;
  readonly done: boolean;
}

export interface RoadmapTimelineGroup {
  readonly rootId: RoadmapItemId;
  readonly title: string;
  readonly firstRow: number;
  readonly rowCount: number;
}

/** Row indexes, from the blocker to the item it blocks. */
export interface RoadmapTimelineEdge {
  readonly from: number;
  readonly to: number;
}

export interface RoadmapTimelineSprintBand {
  readonly sprintId: RoadmapSprintId;
  readonly name: string;
  readonly area: RoadmapArea;
  readonly start: number;
  readonly end: number;
}

export interface RoadmapTimelineLayout {
  /** Days in the range. */
  readonly days: number;
  /** Null when today is outside the range. */
  readonly todayOffset: number | null;
  readonly groups: ReadonlyArray<RoadmapTimelineGroup>;
  readonly rows: ReadonlyArray<RoadmapTimelineRow>;
  readonly edges: ReadonlyArray<RoadmapTimelineEdge>;
  readonly sprintBands: ReadonlyArray<RoadmapTimelineSprintBand>;
  /** Items in the area left off because they have neither a start nor a due date. */
  readonly hiddenWithoutDates: number;
}

interface Bar {
  readonly start: IsoDate;
  readonly end: IsoDate;
}

/**
 * From the start date, or the earlier of creation and the due date, to the
 * due date. With only a start date, to the forecast when it is later, else a
 * single day. Null without either date.
 */
function barOf(
  item: RoadmapWorkItem,
  forecast: RoadmapForecast | undefined,
  dateOf: RoadmapDateOf,
): Bar | null {
  const due = item.dueDate;
  if (due !== null) {
    const created = dateOf(item.createdAt);
    const start = item.startDate ?? (created < due ? created : due);
    return { start: start < due ? start : due, end: due };
  }
  if (item.startDate === null) return null;
  const projected = forecast?.projected ?? null;
  return {
    start: item.startDate,
    end: projected !== null && projected > item.startDate ? projected : item.startDate,
  };
}

export function layoutTimeline(input: RoadmapTimelineInput): RoadmapTimelineLayout {
  const { items, range, today, forecasts } = input;
  const dateOf = input.dateOf ?? utcDateOf;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const visible = (item: RoadmapWorkItem) =>
    input.area == null || effectiveArea(item.id, byId).area === input.area;
  const offset = (date: IsoDate) => daysBetween(range.start, date);

  const rows: RoadmapTimelineRow[] = [];
  const groups: RoadmapTimelineGroup[] = [];
  const rowIndex = new Map<RoadmapItemId, number>();
  let hiddenWithoutDates = 0;

  // The top visible ancestor heads the group, so an area filter never groups under a hidden root.
  const walk = (node: RoadmapTreeNode, group: RoadmapTreeNode | null, depth: number) => {
    const shown = visible(node.item);
    const head = group ?? (shown ? node : null);
    if (shown) {
      const forecast = forecasts.get(node.item.id);
      const bar = barOf(node.item, forecast, dateOf);
      if (bar === null) {
        hiddenWithoutDates += 1;
      } else {
        const due = node.item.dueDate;
        const projected = forecast?.projected ?? null;
        rowIndex.set(node.item.id, rows.length);
        rows.push({
          itemId: node.item.id,
          groupId: head!.item.id,
          depth,
          start: offset(bar.start),
          end: offset(bar.end),
          due: due === null ? null : offset(due),
          forecast:
            due !== null && projected !== null && projected > due && forecast !== undefined
              ? { status: forecast.status, end: offset(projected) }
              : null,
          progress: input.progress?.get(node.item.id) ?? null,
          done: node.item.state === "done",
        });
      }
    }
    for (const child of node.children) {
      walk(child, head, head === null ? 0 : depth + 1);
    }
  };

  for (const root of buildTree(items)) walk(root, null, 0);
  // Rows of one group are contiguous; a hidden root can leave several groups behind it.
  for (let start = 0; start < rows.length;) {
    const groupId = rows[start]!.groupId;
    let end = start;
    while (end < rows.length && rows[end]!.groupId === groupId) end += 1;
    groups.push({
      rootId: groupId,
      title: byId.get(groupId)?.title ?? "",
      firstRow: start,
      rowCount: end - start,
    });
    start = end;
  }

  const edges: RoadmapTimelineEdge[] = [];
  for (const [to, row] of rows.entries()) {
    for (const blockerId of byId.get(row.itemId)?.blockedBy ?? []) {
      const from = rowIndex.get(blockerId);
      if (from !== undefined) edges.push({ from, to });
    }
  }

  const days = daysBetween(range.start, range.end) + 1;
  const todayOffset = offset(today);
  return {
    days,
    todayOffset: todayOffset >= 0 && todayOffset < days ? todayOffset : null,
    groups,
    rows,
    edges,
    sprintBands: input.sprints
      .filter((sprint) => input.area == null || sprint.area === input.area)
      .map((sprint) => ({
        sprintId: sprint.id,
        name: sprint.name,
        area: sprint.area,
        start: offset(sprint.startDate),
        end: offset(sprint.endDate),
      })),
    hiddenWithoutDates,
  };
}

const LEAD_DAYS = 7;
const TRAIL_DAYS = 14;
const MIN_AHEAD_DAYS = 28;
const MONDAY = [1];

/**
 * A range that fits every bar and forecast with a week before and two after,
 * starting on a Monday so week columns line up, and always showing four weeks
 * past today.
 */
export function defaultTimelineRange(input: {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly forecasts: ReadonlyMap<RoadmapItemId, RoadmapForecast>;
  readonly today: IsoDate;
  readonly dateOf?: RoadmapDateOf;
}): RoadmapTimelineRange {
  const dateOf = input.dateOf ?? utcDateOf;
  let earliest = input.today;
  let latest = input.today;
  for (const item of input.items) {
    const forecast = input.forecasts.get(item.id);
    const bar = barOf(item, forecast, dateOf);
    if (bar === null) continue;
    if (bar.start < earliest) earliest = bar.start;
    if (bar.end > latest) latest = bar.end;
    const projected = forecast?.projected ?? null;
    if (projected !== null && projected > latest) latest = projected;
  }
  let start = addDays(earliest, -LEAD_DAYS);
  while (!isWorkingDay(start, MONDAY)) start = addDays(start, -1);
  const trailing = addDays(latest, TRAIL_DAYS);
  const ahead = addDays(input.today, MIN_AHEAD_DAYS);
  return { start, end: trailing > ahead ? trailing : ahead };
}
