/**
 * Fork: roadmap. Pure rules behind the Roadmap card on the thread view.
 */
import type {
  IsoDate,
  RoadmapActor,
  RoadmapItemId,
  RoadmapThreadRef,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { attachedItemFor } from "@lathe/client-runtime/roadmap/tree";
import { effectiveArea } from "@lathe/shared/roadmap";
import {
  addDays,
  burned,
  forecast,
  type RoadmapForecast,
  type RoadmapItemsById,
  totalUnits,
} from "@lathe/shared/roadmapCalc";

import { workingDaysLeft } from "./roadmap.logic";
import {
  formatRoadmapDate,
  ROADMAP_FORECAST_LABELS,
  roadmapVelocityLookup,
  type RoadmapForecastShownStatus,
  type RoadmapForecastsInput,
} from "./roadmapPage.logic";

/** The card's time and progress slots; each is null when the item has nothing to show there. */
export interface RoadmapCardSlots {
  readonly unit: RoadmapUnit;
  readonly daysLeft: number | null;
  readonly forecast:
    | (Omit<RoadmapForecast, "status"> & { readonly status: RoadmapForecastShownStatus })
    | null;
  readonly progress: { readonly burned: number; readonly total: number } | null;
  /** Units per working day in the item's area. */
  readonly velocity: number | null;
  /** Hours logged on this item itself, not its children. */
  readonly hoursLogged: number | null;
}

export function roadmapCardSlots(
  input: RoadmapForecastsInput & { readonly item: RoadmapWorkItem },
): RoadmapCardSlots {
  const { item, today } = input;
  const byId: RoadmapItemsById = new Map(input.items.map((entry) => [entry.id, entry]));
  const area = effectiveArea(item.id, byId).area;
  const { unit, workingWeekdays } = input.areaSettings[area];
  const velocity = roadmapVelocityLookup(input)(area, item.sprintId !== null);
  const projected = forecast({
    item,
    byId,
    unit,
    velocity,
    today,
    weekdays: workingWeekdays,
  });
  const total = totalUnits(item, byId, unit);
  const hoursLogged = item.hours.reduce((sum, entry) => sum + entry.hours, 0);
  return {
    unit,
    daysLeft: item.dueDate === null ? null : workingDaysLeft(today, item.dueDate, workingWeekdays),
    forecast:
      projected.status === "no-forecast" ? null : { ...projected, status: projected.status },
    progress: total === null || total === 0 ? null : { burned: burned(item, byId, unit), total },
    velocity: velocity?.perDay ?? null,
    hoursLogged: item.hours.length === 0 ? null : hoursLogged,
  };
}

const UNIT_WORDS: Readonly<Record<RoadmapUnit, readonly [one: string, many: string]>> = {
  points: ["pt", "pts"],
  hours: ["hr", "hrs"],
  items: ["item", "items"],
  criteria: ["criterion", "criteria"],
};

const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);
const unitWord = (value: number, unit: RoadmapUnit) => UNIT_WORDS[unit][value === 1 ? 0 : 1];

export function formatUnitAmount(value: number, unit: RoadmapUnit): string {
  return `${oneDecimal(value)} ${unitWord(value, unit)}`;
}

/** "6 of 10 pts". */
export function formatUnitProgress(
  progress: { readonly burned: number; readonly total: number },
  unit: RoadmapUnit,
): string {
  return `${oneDecimal(progress.burned)} of ${formatUnitAmount(progress.total, unit)}`;
}

/** "1.4 pts / day". */
export function formatVelocity(perDay: number, unit: RoadmapUnit): string {
  return `${formatUnitAmount(perDay, unit)} / day`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "At risk, Fri Oct 23": the card has room for the weekday the lists leave out. */
export function cardForecastText(value: RoadmapForecast, today: IsoDate): string | null {
  if (value.status === "no-forecast") return null;
  const label = ROADMAP_FORECAST_LABELS[value.status];
  if (value.projected === null) return label;
  const [year, month, day] = value.projected.split("-").map(Number);
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()]!;
  return `${label}, ${weekday} ${formatRoadmapDate(value.projected, today)}`;
}

export interface RoadmapSnoozeChoice {
  readonly label: string;
  readonly until: IsoDate;
}

/** Snooze is to a date after today; "Next Monday" from a Monday is a week on. */
export function snoozeChoices(today: IsoDate): ReadonlyArray<RoadmapSnoozeChoice> {
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  const toMonday = (8 - weekday) % 7 || 7;
  return [
    { label: "Tomorrow", until: addDays(today, 1) },
    { label: "Next Monday", until: addDays(today, toMonday) },
    { label: "In a week", until: addDays(today, 7) },
  ];
}

/** The item's ancestors from the root down; stops at a missing parent or a corrupt loop. */
export function parentPath(
  item: RoadmapWorkItem,
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
): ReadonlyArray<RoadmapWorkItem> {
  const path: RoadmapWorkItem[] = [];
  const seen = new Set<RoadmapItemId>([item.id]);
  let parentId = item.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    seen.add(parentId);
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

/** Items waiting on this one: the reverse of `blockedBy`. */
export function blocksOf(
  item: RoadmapWorkItem,
  items: ReadonlyArray<RoadmapWorkItem>,
): ReadonlyArray<RoadmapWorkItem> {
  return items.filter((other) => other.blockedBy.includes(item.id));
}

export function roadmapActorLabel(actor: RoadmapActor): string {
  switch (actor._tag) {
    case "user":
      return "You";
    case "agent":
      return actor.threadTitle;
    case "steward":
      return "Steward";
    case "github":
      return "GitHub";
  }
}

/**
 * Whether the card is open: the user's own choice for this thread once made,
 * otherwise open exactly when the thread is on the roadmap.
 */
export function roadmapCardOpen(override: boolean | null, attached: boolean): boolean {
  return override ?? attached;
}

export type RoadmapCardView =
  | { readonly kind: "hidden" }
  | { readonly kind: "offline" }
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "attached"; readonly item: RoadmapWorkItem };

export function roadmapCardView(input: {
  /** The home advertises a roadmap. */
  readonly supported: boolean;
  readonly homeConnected: boolean;
  /** The thread lives on the home, so a disconnected home is a disconnected thread too. */
  readonly threadOnHome: boolean;
  /** The home's items, or null until the first snapshot arrives. */
  readonly items: ReadonlyArray<RoadmapWorkItem> | null;
  readonly thread: RoadmapThreadRef;
}): RoadmapCardView {
  if (!input.supported) return { kind: "hidden" };
  if (!input.threadOnHome && !input.homeConnected) return { kind: "offline" };
  if (input.items === null) return { kind: "loading" };
  const item = attachedItemFor(input.items, input.thread);
  return item === null ? { kind: "empty" } : { kind: "attached", item };
}
