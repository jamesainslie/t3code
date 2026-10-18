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
} from "@lathe/contracts";

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

const DAY_MS = 86_400_000;
const dayNumber = (iso: IsoDate) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year!, month! - 1, day!) / DAY_MS);
};
// Day 0 of the epoch was a Thursday.
const isWeekday = (dayIndex: number) => {
  const weekday = (((dayIndex + 4) % 7) + 7) % 7;
  return weekday !== 0 && weekday !== 6;
};
/** Weekdays in [fromDay, toDay), counting whole weeks at once so far dates stay cheap. */
const weekdaysIn = (fromDay: number, toDay: number) => {
  const span = toDay - fromDay;
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * 5;
  for (let day = fromDay + fullWeeks * 7; day < toDay; day += 1) {
    if (isWeekday(day)) count += 1;
  }
  return count;
};

/**
 * Working days left until a due date: weekdays after today up to and
 * including the due date. Once it has passed, the weekdays after the due date
 * up to and including today, negated, so the count is symmetric about the due
 * date. Phase 1 counts plain weekdays; per-area calendars come later.
 */
export function workingDaysLeft(today: IsoDate, due: IsoDate): number {
  const todayDay = dayNumber(today);
  const dueDay = dayNumber(due);
  // Subtracting from 0 rather than negating keeps a weekend-only gap at 0, not -0.
  return dueDay >= todayDay
    ? weekdaysIn(todayDay + 1, dueDay + 1)
    : 0 - weekdaysIn(dueDay + 1, todayDay + 1);
}

/** The local calendar date, which is what a due date means to the user. */
export function localIsoDate(now: Date): IsoDate {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
