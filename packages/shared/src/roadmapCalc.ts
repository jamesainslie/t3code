/**
 * Fork: roadmap calculations, pure and deterministic, so the client's views,
 * the MCP tools and the turn context all agree. Every function that depends on
 * the date takes `today`; none reads the clock.
 */
import type {
  IsoDate,
  RoadmapArea,
  RoadmapAreaSettings,
  RoadmapItemId,
  RoadmapSprint,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { effectiveArea, effectivePriority } from "./roadmap.ts";

/** Days of the week that count, 0 being Sunday. */
export type RoadmapWeekdays = ReadonlyArray<number>;
export type RoadmapItemsById = ReadonlyMap<RoadmapItemId, RoadmapWorkItem>;
/** The calendar date an instant falls on for the user. */
export type RoadmapDateOf = (at: string) => IsoDate;

const DAY_MS = 86_400_000;
const DEFAULT_WEEKDAYS: RoadmapWeekdays = [1, 2, 3, 4, 5];

export const VELOCITY_WINDOW_WORKING_DAYS = 15;
export const VELOCITY_MIN_SAMPLES = 5;
const VELOCITY_SPRINT_COUNT = 3;
const AT_RISK_SLACK_SHARE = 0.2;

// Calendar

const dayNumber = (date: IsoDate) => {
  const [year, month, day] = date.split("-").map(Number);
  return Math.round(Date.UTC(year!, month! - 1, day!) / DAY_MS);
};
const dateOfDay = (day: number): IsoDate =>
  DateTime.formatIsoDateUtc(DateTime.makeUnsafe(day * DAY_MS));
// Day 0 of the epoch was a Thursday.
const weekdayOfDay = (day: number) => (((day + 4) % 7) + 7) % 7;
// Settings never hold an empty week, but a stray one must not loop forever.
const workingSet = (weekdays: RoadmapWeekdays) =>
  new Set(weekdays.length === 0 ? DEFAULT_WEEKDAYS : weekdays);

/** Working days in [fromDay, toDay), counting whole weeks at once so far dates stay cheap. */
const workingDaysIn = (fromDay: number, toDay: number, working: ReadonlySet<number>) => {
  const fullWeeks = Math.floor((toDay - fromDay) / 7);
  let count = fullWeeks * working.size;
  for (let day = fromDay + fullWeeks * 7; day < toDay; day += 1) {
    if (working.has(weekdayOfDay(day))) count += 1;
  }
  return count;
};

export const utcDateOf: RoadmapDateOf = (at) =>
  Option.match(DateTime.make(at), {
    onNone: () => at.slice(0, 10),
    onSome: DateTime.formatIsoDateUtc,
  });

/** The date in this process's time zone: the user's own in a client. */
export const localDateOf: RoadmapDateOf = (at) =>
  Option.match(DateTime.make(at), {
    onNone: () => at.slice(0, 10),
    onSome: (instant) =>
      DateTime.formatIsoDate(DateTime.setZone(instant, DateTime.zoneMakeLocal())),
  });

export function addDays(date: IsoDate, days: number): IsoDate {
  return dateOfDay(dayNumber(date) + days);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

export function isWorkingDay(date: IsoDate, weekdays: RoadmapWeekdays): boolean {
  return workingSet(weekdays).has(weekdayOfDay(dayNumber(date)));
}

/**
 * Working days after `from` up to and including `to`. When `to` is earlier,
 * the working days after `to` up to and including `from`, negated, so the
 * count is symmetric and a gap of only non-working days is 0.
 */
export function workingDaysBetween(from: IsoDate, to: IsoDate, weekdays: RoadmapWeekdays): number {
  const working = workingSet(weekdays);
  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);
  // Subtracting from 0 rather than negating keeps an empty gap at 0, not -0.
  return toDay >= fromDay
    ? workingDaysIn(fromDay + 1, toDay + 1, working)
    : 0 - workingDaysIn(toDay + 1, fromDay + 1, working);
}

/**
 * The `count`th working day after `from`, or before it when negative; `from`
 * itself is never counted. Inverts `workingDaysBetween` from any date going
 * forward, and from a working day going back. A fractional count is truncated.
 */
export function addWorkingDays(from: IsoDate, count: number, weekdays: RoadmapWeekdays): IsoDate {
  const working = workingSet(weekdays);
  const step = count < 0 ? -1 : 1;
  const steps = Math.abs(Math.trunc(count));
  let day = dayNumber(from);
  for (let counted = 0; counted < steps;) {
    day += step;
    if (working.has(weekdayOfDay(day))) counted += 1;
  }
  return dateOfDay(day);
}

/**
 * The exclusive start of the trailing window: the day before the `count`th
 * working day counting back from `today` inclusive, so the window always holds
 * exactly `count` working days, even when today is a weekend.
 */
function trailingWindowStart(today: IsoDate, count: number, weekdays: RoadmapWeekdays): IsoDate {
  const working = workingSet(weekdays);
  let day = dayNumber(today);
  for (let counted = 0; counted < count; day -= 1) {
    if (working.has(weekdayOfDay(day))) counted += 1;
  }
  return dateOfDay(day);
}

// Tree

const childIndexes = new WeakMap<
  RoadmapItemsById,
  ReadonlyMap<RoadmapItemId, ReadonlyArray<RoadmapWorkItem>>
>();

/** Cached per map, so walking a whole tree stays linear. */
function childIndex(byId: RoadmapItemsById) {
  const cached = childIndexes.get(byId);
  if (cached !== undefined) return cached;
  const index = new Map<RoadmapItemId, RoadmapWorkItem[]>();
  for (const entry of byId.values()) {
    if (entry.parentId === null || !byId.has(entry.parentId)) continue;
    const siblings = index.get(entry.parentId) ?? [];
    siblings.push(entry);
    index.set(entry.parentId, siblings);
  }
  for (const siblings of index.values()) siblings.sort(bySiblingOrder);
  childIndexes.set(byId, index);
  return index;
}

const bySiblingOrder = (left: RoadmapWorkItem, right: RoadmapWorkItem) =>
  left.sortKey < right.sortKey
    ? -1
    : left.sortKey > right.sortKey
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;

export function childrenOf(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
): ReadonlyArray<RoadmapWorkItem> {
  return childIndex(byId).get(item.id) ?? [];
}

/** The item and everything under it in tree order; stops at a corrupt loop. */
export function subtreeOf(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
): ReadonlyArray<RoadmapWorkItem> {
  const seen = new Set<RoadmapItemId>();
  const result: RoadmapWorkItem[] = [];
  const pending = [item];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    result.push(next);
    const children = childrenOf(next, byId);
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
  return result;
}

/** The leaves under an item, or the item itself when it has no children. */
export function leavesUnder(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
): ReadonlyArray<RoadmapWorkItem> {
  return subtreeOf(item, byId).filter((entry) => childrenOf(entry, byId).length === 0);
}

export interface RoadmapRolledUpEstimate {
  /** The direct estimate when set, else the children's sum. */
  readonly value: number | null;
  readonly direct: number | null;
  readonly fromChildren: number | null;
  /** A direct estimate and the children's sum both exist and disagree. */
  readonly differs: boolean;
}

export function rolledUpEstimate(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
): RoadmapRolledUpEstimate {
  const visit = (node: RoadmapWorkItem, seen: ReadonlySet<RoadmapItemId>): number | null => {
    const children = childrenOf(node, byId).filter((entry) => !seen.has(entry.id));
    const sum = sumOf(children.map((entry) => visit(entry, new Set([...seen, entry.id]))));
    return node.estimate ?? sum;
  };
  const seen = new Set([item.id]);
  const fromChildren = sumOf(
    childrenOf(item, byId)
      .filter((entry) => !seen.has(entry.id))
      .map((entry) => visit(entry, new Set([...seen, entry.id]))),
  );
  const direct = item.estimate;
  return {
    value: direct ?? fromChildren,
    direct,
    fromChildren,
    differs: direct !== null && fromChildren !== null && direct !== fromChildren,
  };
}

/** Null when every value is null, so "no estimate" stays distinct from zero. */
function sumOf(values: ReadonlyArray<number | null>): number | null {
  let total: number | null = null;
  for (const value of values) {
    if (value !== null) total = (total ?? 0) + value;
  }
  return total;
}

// Progress

/** The item's scope in the unit: what `burned` counts toward. */
export function totalUnits(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
  unit: RoadmapUnit,
): number | null {
  switch (unit) {
    case "items":
      return leavesUnder(item, byId).length;
    case "criteria": {
      const count = subtreeOf(item, byId).reduce((sum, entry) => sum + entry.criteria.length, 0);
      return count === 0 ? null : count;
    }
    case "points":
    case "hours":
      return rolledUpEstimate(item, byId).value;
  }
}

export function burned(item: RoadmapWorkItem, byId: RoadmapItemsById, unit: RoadmapUnit): number {
  switch (unit) {
    case "items":
      return leavesUnder(item, byId).filter((leaf) => leaf.state === "done").length;
    case "points":
      return leavesUnder(item, byId).reduce(
        (sum, leaf) => sum + (leaf.state === "done" ? (leaf.estimate ?? 0) : 0),
        0,
      );
    case "criteria":
      return subtreeOf(item, byId).reduce(
        (sum, entry) =>
          sum + entry.criteria.filter((criterion) => criterion.tickedAt !== null).length,
        0,
      );
    case "hours":
      return subtreeOf(item, byId).reduce(
        (sum, entry) => sum + entry.hours.reduce((hours, log) => hours + log.hours, 0),
        0,
      );
  }
}

/** Zero once done; null without a total to burn against. */
export function remaining(
  item: RoadmapWorkItem,
  byId: RoadmapItemsById,
  unit: RoadmapUnit,
): number | null {
  if (item.state === "done") return 0;
  const total = totalUnits(item, byId, unit);
  return total === null ? null : Math.max(0, total - burned(item, byId, unit));
}

// Velocity

interface BurnSample {
  readonly item: RoadmapWorkItem;
  readonly date: IsoDate;
  readonly units: number;
}

/**
 * Every recorded unit of progress with its date. Items and points count done
 * leaves only, so closing an epic and its stories never counts twice.
 */
function burnSamples(
  items: ReadonlyArray<RoadmapWorkItem>,
  byId: RoadmapItemsById,
  unit: RoadmapUnit,
  dateOf: RoadmapDateOf,
): ReadonlyArray<BurnSample> {
  const samples: BurnSample[] = [];
  for (const item of items) {
    switch (unit) {
      case "items":
      case "points": {
        if (item.completedAt === null || childrenOf(item, byId).length > 0) break;
        if (unit === "points" && item.estimate === null) break;
        const units = unit === "items" ? 1 : (item.estimate ?? 0);
        samples.push({ item, date: dateOf(item.completedAt), units });
        break;
      }
      case "criteria":
        for (const criterion of item.criteria) {
          if (criterion.tickedAt !== null) {
            samples.push({ item, date: dateOf(criterion.tickedAt), units: 1 });
          }
        }
        break;
      case "hours":
        for (const entry of item.hours) {
          samples.push({ item, date: dateOf(entry.at), units: entry.hours });
        }
        break;
    }
  }
  return samples;
}

export interface RoadmapVelocity {
  readonly perDay: number;
  readonly sampleSize: number;
  readonly units: number;
  readonly workingDays: number;
  readonly source: "window" | "sprints";
}

export interface RoadmapVelocityInput {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly area: RoadmapArea;
  readonly settings: RoadmapAreaSettings;
  readonly today: IsoDate;
  readonly sprints?: ReadonlyArray<RoadmapSprint>;
  /** For an item in a sprint: use the area's last three finished sprints when there are three. */
  readonly useSprints?: boolean;
  readonly dateOf?: RoadmapDateOf;
}

const areaItems = (items: ReadonlyArray<RoadmapWorkItem>, area: RoadmapArea) => {
  const byId: RoadmapItemsById = new Map(items.map((entry) => [entry.id, entry]));
  return { byId, inArea: items.filter((entry) => effectiveArea(entry.id, byId).area === area) };
};

const windowStart = (today: IsoDate, weekdays: RoadmapWeekdays) =>
  trailingWindowStart(today, VELOCITY_WINDOW_WORKING_DAYS, weekdays);

/** Units done per working day in the area; null under five samples. */
export function velocity(input: RoadmapVelocityInput): RoadmapVelocity | null {
  const { settings, today } = input;
  const dateOf = input.dateOf ?? utcDateOf;
  const weekdays = settings.workingWeekdays;
  const { byId, inArea } = areaItems(input.items, input.area);
  const samples = burnSamples(inArea, byId, settings.unit, dateOf);

  if (input.useSprints === true) {
    const finished = (input.sprints ?? [])
      .filter((sprint) => sprint.area === input.area && sprint.endDate < today)
      .sort((left, right) => (left.endDate < right.endDate ? 1 : -1))
      .slice(0, VELOCITY_SPRINT_COUNT);
    if (finished.length === VELOCITY_SPRINT_COUNT) {
      const inSprints = samples.filter((sample) =>
        finished.some(
          (sprint) =>
            sample.item.sprintId === sprint.id &&
            sample.date >= sprint.startDate &&
            sample.date <= sprint.endDate,
        ),
      );
      const workingDays = finished.reduce(
        (sum, sprint) =>
          sum + workingDaysBetween(addDays(sprint.startDate, -1), sprint.endDate, weekdays),
        0,
      );
      const result = summarize(inSprints, workingDays, "sprints");
      if (result !== null) return result;
    }
  }

  const start = windowStart(today, weekdays);
  return summarize(
    samples.filter((sample) => sample.date > start && sample.date <= today),
    VELOCITY_WINDOW_WORKING_DAYS,
    "window",
  );
}

function summarize(
  samples: ReadonlyArray<BurnSample>,
  workingDays: number,
  source: RoadmapVelocity["source"],
): RoadmapVelocity | null {
  if (samples.length < VELOCITY_MIN_SAMPLES || workingDays <= 0) return null;
  const units = samples.reduce((sum, sample) => sum + sample.units, 0);
  return { perDay: units / workingDays, sampleSize: samples.length, units, workingDays, source };
}

/**
 * The mean size of the area's done leaves in the trailing window, which Today
 * counts for a row with no estimate. Leaves with no size in the unit are skipped.
 */
export function averageLeafSize(
  input: Omit<RoadmapVelocityInput, "sprints" | "useSprints">,
): number | null {
  const { settings, today } = input;
  const dateOf = input.dateOf ?? utcDateOf;
  const { byId, inArea } = areaItems(input.items, input.area);
  const start = windowStart(today, settings.workingWeekdays);
  const sizes = inArea.flatMap((entry) => {
    if (entry.completedAt === null || childrenOf(entry, byId).length > 0) return [];
    const date = dateOf(entry.completedAt);
    if (date <= start || date > today) return [];
    const size = totalUnits(entry, byId, settings.unit);
    return size === null || size === 0 ? [] : [size];
  });
  return sizes.length === 0 ? null : sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
}

// Forecast

export type RoadmapForecastStatus = "on-track" | "at-risk" | "late" | "no-forecast";

export interface RoadmapForecast {
  readonly status: RoadmapForecastStatus;
  readonly projected: IsoDate | null;
  /** Working days from the projected date to the due date; negative when late. */
  readonly slackDays: number | null;
}

const NO_FORECAST: RoadmapForecast = { status: "no-forecast", projected: null, slackDays: null };

/**
 * Projected date is today plus remaining units over velocity, in whole working
 * days. Late when projected after due; at risk when the slack is under 20
 * percent of the working days left; on track otherwise, or with no due date.
 */
export function forecast(input: {
  readonly item: RoadmapWorkItem;
  readonly byId: RoadmapItemsById;
  readonly unit: RoadmapUnit;
  readonly velocity: RoadmapVelocity | null;
  readonly today: IsoDate;
  readonly weekdays: RoadmapWeekdays;
}): RoadmapForecast {
  const { item, today, weekdays } = input;
  if (item.state === "done" || input.velocity === null || input.velocity.perDay <= 0) {
    return NO_FORECAST;
  }
  const left = remaining(item, input.byId, input.unit);
  if (left === null) return NO_FORECAST;
  // The epsilon keeps float noise such as 3.0000000004 from costing a whole day.
  const days = Math.max(0, Math.ceil(left / input.velocity.perDay - 1e-9));
  const projected = addWorkingDays(today, days, weekdays);
  const due = item.dueDate;
  if (due === null) return { status: "on-track", projected, slackDays: null };
  const slackDays = workingDaysBetween(projected, due, weekdays);
  if (projected > due) return { status: "late", projected, slackDays };
  const daysLeft = workingDaysBetween(today, due, weekdays);
  return {
    status: slackDays < AT_RISK_SLACK_SHARE * daysLeft ? "at-risk" : "on-track",
    projected,
    slackDays,
  };
}

// Burndown

export interface RoadmapBurndownPoint {
  readonly date: IsoDate;
  /** Null for days after today. */
  readonly remaining: number | null;
  readonly ideal: number;
}

export interface RoadmapBurndown {
  readonly total: number;
  readonly points: ReadonlyArray<RoadmapBurndownPoint>;
}

/**
 * Remaining units at the end of each working day from the start to the due
 * date, beside a straight ideal line to zero. An item starts on its start date
 * or creation; a sprint runs between its dates. Null without an end date or a
 * total, or when the end comes before the start.
 */
export function burndown(input: {
  readonly scope:
    | { readonly kind: "item"; readonly item: RoadmapWorkItem }
    | { readonly kind: "sprint"; readonly sprint: RoadmapSprint };
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly unit: RoadmapUnit;
  readonly today: IsoDate;
  readonly weekdays: RoadmapWeekdays;
  readonly dateOf?: RoadmapDateOf;
}): RoadmapBurndown | null {
  const { scope, unit, today, weekdays } = input;
  const dateOf = input.dateOf ?? utcDateOf;
  const byId: RoadmapItemsById = new Map(input.items.map((entry) => [entry.id, entry]));
  const roots =
    scope.kind === "item"
      ? [scope.item]
      : input.items.filter((entry) => {
          if (entry.sprintId !== scope.sprint.id) return false;
          // An item whose ancestor is in the sprint is already inside that ancestor's scope.
          const seen = new Set<RoadmapItemId>([entry.id]);
          let parentId = entry.parentId;
          while (parentId !== null && !seen.has(parentId)) {
            const parent = byId.get(parentId);
            if (parent === undefined) break;
            if (parent.sprintId === scope.sprint.id) return false;
            seen.add(parentId);
            parentId = parent.parentId;
          }
          return true;
        });
  const start =
    scope.kind === "item"
      ? (scope.item.startDate ?? dateOf(scope.item.createdAt))
      : scope.sprint.startDate;
  const end = scope.kind === "item" ? scope.item.dueDate : scope.sprint.endDate;
  if (end === null || end < start || roots.length === 0) return null;
  const total = sumOf(roots.map((root) => totalUnits(root, byId, unit)));
  if (total === null) return null;

  const scopeItems = new Map<RoadmapItemId, RoadmapWorkItem>();
  for (const root of roots) {
    for (const entry of subtreeOf(root, byId)) scopeItems.set(entry.id, entry);
  }
  const samples = burnSamples([...scopeItems.values()], byId, unit, dateOf);
  const steps = workingDaysBetween(start, end, weekdays);
  const dates = [start];
  for (let index = 1; index <= steps; index += 1) {
    dates.push(addWorkingDays(start, index, weekdays));
  }
  return {
    total,
    points: dates.map((date, index) => ({
      date,
      remaining:
        date > today
          ? null
          : Math.max(
              0,
              total -
                samples.reduce((sum, sample) => sum + (sample.date <= date ? sample.units : 0), 0),
            ),
      ideal: steps === 0 ? 0 : total * (1 - index / steps),
    })),
  };
}

// Rank

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 } as const;
const MAX_RANK_DEPTH = 64;

const isAncestor = (ancestor: RoadmapWorkItem, item: RoadmapWorkItem, byId: RoadmapItemsById) => {
  const seen = new Set<RoadmapItemId>([item.id]);
  let parentId = item.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    if (parentId === ancestor.id) return true;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
};

/**
 * The one ordering every roadmap list uses: effective priority, then an
 * ancestor before its descendants, then the parents' rank recursively, then
 * sibling order. So a P0 epic under a lower objective beats a P2 epic under
 * the top one.
 */
export function compareRank(
  left: RoadmapWorkItem,
  right: RoadmapWorkItem,
  byId: RoadmapItemsById,
): number {
  const compare = (a: RoadmapWorkItem, b: RoadmapWorkItem, depth: number): number => {
    if (a.id === b.id) return 0;
    const byPriority =
      PRIORITY_ORDER[effectivePriority(a.id, byId).priority] -
      PRIORITY_ORDER[effectivePriority(b.id, byId).priority];
    if (byPriority !== 0) return byPriority;
    if (isAncestor(a, b, byId)) return -1;
    if (isAncestor(b, a, byId)) return 1;
    const parentA = a.parentId === null ? undefined : byId.get(a.parentId);
    const parentB = b.parentId === null ? undefined : byId.get(b.parentId);
    if (depth < MAX_RANK_DEPTH && parentA?.id !== parentB?.id) {
      // Against a root, a child ranks where its parent does, so it stays with its tree.
      const byParent = compare(parentA ?? a, parentB ?? b, depth + 1);
      if (byParent !== 0) return byParent;
    }
    return bySiblingOrder(a, b);
  };
  return compare(left, right, 0);
}

// Activity

/**
 * The latest sign of work on the item: a state change, a ticked criterion,
 * logged hours, or activity on an attached thread, which the caller supplies
 * per item so this module stays free of thread types.
 */
export function lastActivityAt(
  item: RoadmapWorkItem,
  threadActivity: ReadonlyMap<RoadmapItemId, { readonly latestActivityAt: string | null }>,
): string {
  let latest = item.stateChangedAt;
  let latestMs = Date.parse(latest);
  const consider = (value: string | null) => {
    if (value === null) return;
    const ms = Date.parse(value);
    if (ms > latestMs || Number.isNaN(latestMs)) {
      latest = value;
      latestMs = ms;
    }
  };
  for (const criterion of item.criteria) consider(criterion.tickedAt);
  for (const entry of item.hours) consider(entry.at);
  consider(threadActivity.get(item.id)?.latestActivityAt ?? null);
  return latest;
}

export function isSnoozed(item: RoadmapWorkItem, today: IsoDate): boolean {
  return item.snoozedUntil !== null && item.snoozedUntil > today;
}
