/**
 * Fork: roadmap. Labels, orderings and pure helpers that the Roadmap page,
 * the Roadmap card, the thread menu and the command palette all share.
 */
import {
  type IsoDate,
  type RoadmapArea,
  type RoadmapCriterion,
  type RoadmapItemState,
  RoadmapItemType,
  type RoadmapPriority,
  type RoadmapUnit,
} from "@lathe/contracts";
import { workingDaysBetween } from "@lathe/shared/roadmapCalc";

/** Hierarchy order, which is also the order the create menus list them in. */
export const ROADMAP_TYPES: ReadonlyArray<RoadmapItemType> = RoadmapItemType.literals;
export const ROADMAP_STATES: ReadonlyArray<RoadmapItemState> = [
  "backlog",
  "in-progress",
  "in-review",
  "done",
];
export const ROADMAP_PRIORITIES: ReadonlyArray<RoadmapPriority> = ["p0", "p1", "p2", "p3"];
export const ROADMAP_AREAS: ReadonlyArray<RoadmapArea> = ["work", "personal"];

export const ROADMAP_TYPE_LABELS: Readonly<Record<RoadmapItemType, string>> = {
  objective: "Objective",
  "key-result": "Key result",
  initiative: "Initiative",
  epic: "Epic",
  feature: "Feature",
  story: "Story",
  bug: "Bug",
  "support-ticket": "Support ticket",
};
export const ROADMAP_STATE_LABELS: Readonly<Record<RoadmapItemState, string>> = {
  backlog: "Backlog",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};
export const ROADMAP_PRIORITY_LABELS: Readonly<Record<RoadmapPriority, string>> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
};
export const ROADMAP_AREA_LABELS: Readonly<Record<RoadmapArea, string>> = {
  work: "Work",
  personal: "Personal",
};

export function criteriaProgress(criteria: ReadonlyArray<RoadmapCriterion>): {
  readonly ticked: number;
  readonly total: number;
} {
  return {
    ticked: criteria.filter((criterion) => criterion.tickedAt !== null).length,
    total: criteria.length,
  };
}

export const ROADMAP_UNITS: ReadonlyArray<RoadmapUnit> = ["points", "hours", "items", "criteria"];
export const ROADMAP_UNIT_LABELS: Readonly<Record<RoadmapUnit, string>> = {
  points: "Points",
  hours: "Hours",
  items: "Items",
  criteria: "Criteria",
};

/** Monday to Friday, for a caller with no area calendar to hand. */
const DEFAULT_WORKING_WEEKDAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

/** Indexed 0 for Sunday, as area settings number the days. */
export const ROADMAP_WEEKDAY_LABELS: ReadonlyArray<string> = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

/**
 * Working days left until a due date: working days after today up to and
 * including the due date. Once it has passed, the working days after the due
 * date up to and including today, negated, so the count is symmetric about the
 * due date. `weekdays` is the item's area calendar.
 */
export function workingDaysLeft(
  today: IsoDate,
  due: IsoDate,
  weekdays: ReadonlyArray<number> = DEFAULT_WORKING_WEEKDAYS,
): number {
  return workingDaysBetween(today, due, weekdays);
}

/**
 * The days a multi-select toggle reports, as area settings store them. Null
 * for an empty week, which settings refuse.
 */
export function workingWeekdaysFrom(values: ReadonlyArray<string>): ReadonlyArray<number> | null {
  const days = [...new Set(values.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
  return days.length === 0 ? null : days;
}

/** The local calendar date, which is what a due date means to the user. */
export function localIsoDate(now: Date): IsoDate {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
