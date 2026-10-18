/**
 * Fork: roadmap. Today: what matters now, by fixed rules, with every row saying
 * why it is there. Pure, so web and mobile build it from the live roadmap plus
 * the thread and pull request signals they already hold.
 */
import type {
  IsoDate,
  RoadmapArea,
  RoadmapAreaSettings,
  RoadmapItemId,
  RoadmapSprint,
  RoadmapThreadRef,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { effectiveArea, effectivePriority } from "@lathe/shared/roadmap";
import {
  addDays,
  averageLeafSize,
  compareRank,
  forecast,
  isSnoozed,
  lastActivityAt,
  leavesUnder,
  remaining,
  type RoadmapDateOf,
  type RoadmapForecast,
  type RoadmapItemsById,
  type RoadmapVelocity,
  subtreeOf,
  utcDateOf,
  velocity,
  workingDaysBetween,
} from "@lathe/shared/roadmapCalc";

export type RoadmapAwaitingReason = "approval" | "user-input" | "plan-ready" | "turn-finished";

/** What the client knows about an item's attached threads. */
export interface RoadmapThreadSignal {
  /** The latest finished run or message from the user across the attached threads. */
  readonly latestActivityAt: string | null;
  /** The attached thread waiting on the user and why; null when none waits. */
  readonly awaiting: {
    readonly reason: RoadmapAwaitingReason;
    readonly thread: RoadmapThreadRef;
  } | null;
}

/** Keyed by item id. */
export type RoadmapThreadSignals = ReadonlyMap<RoadmapItemId, RoadmapThreadSignal>;

/** Open pull request URLs linked to the item's threads that wait on the viewer's review. */
export type RoadmapReviewRequests = ReadonlyMap<RoadmapItemId, ReadonlyArray<string>>;

export type RoadmapTodaySectionId = "waiting" | "picks" | "due" | "cold" | "unblocked" | "holding";

export interface RoadmapTodayRow {
  readonly itemId: RoadmapItemId;
  readonly section: RoadmapTodaySectionId;
  /** The exact text shown, such as "P0, untouched 6 working days". */
  readonly reason: string;
  readonly area: RoadmapArea;
  /** Remaining units on the item's unfinished leaves in the area's unit; null when none has one. */
  readonly estimate: number | null;
  /** Some unfinished leaf has no estimate, so capacity counted the average size for it. */
  readonly noEstimate: boolean;
  /** Below the capacity line. Waiting rows and picks never are. */
  readonly beyondToday: boolean;
}

export interface RoadmapTodaySection {
  readonly id: RoadmapTodaySectionId;
  readonly title: string;
  readonly rows: ReadonlyArray<RoadmapTodayRow>;
}

export interface RoadmapTodayCapacity {
  readonly area: RoadmapArea;
  readonly unit: RoadmapUnit;
  /** One day's velocity; null with too little history, which means no line. */
  readonly perDay: number | null;
  /** Units the rows above the line take, picks included. */
  readonly used: number;
}

export interface RoadmapToday {
  /** Only sections with rows, in order. */
  readonly sections: ReadonlyArray<RoadmapTodaySection>;
  readonly capacity: Readonly<Record<RoadmapArea, RoadmapTodayCapacity>>;
  /** Open snoozed items, soonest to wake first. */
  readonly snoozed: ReadonlyArray<{ readonly itemId: RoadmapItemId; readonly until: IsoDate }>;
}

export interface RoadmapTodayInput {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly areaSettings: Readonly<Record<RoadmapArea, RoadmapAreaSettings>>;
  readonly threadSignals: RoadmapThreadSignals;
  readonly reviewRequests: RoadmapReviewRequests;
  /** When the user last opened Today; null looks back one day. */
  readonly lastOpenedAt: string | null;
  readonly today: IsoDate;
  readonly now: string;
  /** Defaults to UTC; clients pass the user's own calendar. */
  readonly dateOf?: RoadmapDateOf;
}

const SECTION_TITLES: Readonly<Record<RoadmapTodaySectionId, string>> = {
  waiting: "Waiting on you",
  picks: "Your picks",
  due: "Due or slipping",
  cold: "Going cold",
  unblocked: "Newly unblocked",
  holding: "Holding others up",
};
const SECTION_ORDER: ReadonlyArray<RoadmapTodaySectionId> = [
  "waiting",
  "picks",
  "due",
  "cold",
  "unblocked",
  "holding",
];
const AREAS: ReadonlyArray<RoadmapArea> = ["work", "personal"];
const DUE_SOON_WORKING_DAYS = 3;
const NEVER_OPENED_LOOKBACK_MS = 86_400_000;

const AWAITING_TEXT: Readonly<Record<RoadmapAwaitingReason, string>> = {
  approval: "Waiting for your approval",
  "user-input": "Asked you a question",
  "plan-ready": "Plan ready for your review",
  "turn-finished": "Turn finished, waiting for you",
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
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

/** "today", "tomorrow", a weekday within six days either side, else "Oct 30". */
function roadmapDayLabel(date: IsoDate, today: IsoDate): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  const [year, month, day] = date.split("-").map(Number);
  const dayIndex = Math.round(Date.UTC(year!, month! - 1, day!) / 86_400_000);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const todayIndex = Math.round(Date.UTC(todayYear!, todayMonth! - 1, todayDay!) / 86_400_000);
  if (Math.abs(dayIndex - todayIndex) <= 6) {
    // Day 0 of the epoch was a Thursday.
    return WEEKDAY_NAMES[(((dayIndex + 4) % 7) + 7) % 7]!;
  }
  return `${MONTH_NAMES[month! - 1]} ${day}`;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "A", "A, and B", "A, B, and C". */
const joinReasons = (reasons: ReadonlyArray<string>) =>
  reasons.length <= 1
    ? (reasons[0] ?? "")
    : `${reasons.slice(0, -1).join(", ")}, and ${reasons.at(-1)}`;

/**
 * The steward's unsure notes the user has not answered. A tick on the note's
 * criterion after the note answers it; a note about the whole item is
 * answered by a tick on any criterion. A note whose criterion is gone has
 * nothing left to answer.
 */
function openUnsureNotes(item: RoadmapWorkItem): number {
  const tickedAt = (criterion: RoadmapWorkItem["criteria"][number]) =>
    criterion.tickedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(criterion.tickedAt);
  const criteria = new Map(item.criteria.map((criterion) => [criterion.id, criterion]));
  const lastTick = Math.max(Number.NEGATIVE_INFINITY, ...item.criteria.map(tickedAt));
  return item.progressNotes.filter((note) => {
    if (note.kind !== "unsure" || note.actor._tag !== "steward") return false;
    if (note.criterionId === null) return lastTick < Date.parse(note.at);
    const criterion = criteria.get(note.criterionId);
    return criterion !== undefined && tickedAt(criterion) < Date.parse(note.at);
  }).length;
}

export function buildToday(input: RoadmapTodayInput): RoadmapToday {
  const { items, today, areaSettings, threadSignals, reviewRequests } = input;
  const dateOf = input.dateOf ?? utcDateOf;
  const byId: RoadmapItemsById = new Map(items.map((entry) => [entry.id, entry]));
  const areaOf = (item: RoadmapWorkItem) => effectiveArea(item.id, byId).area;
  const settingsOf = (item: RoadmapWorkItem) => areaSettings[areaOf(item)];
  const rank = (left: RoadmapWorkItem, right: RoadmapWorkItem) => compareRank(left, right, byId);

  const velocities = new Map<string, RoadmapVelocity | null>();
  const velocityFor = (area: RoadmapArea, useSprints: boolean) => {
    const key = `${area}:${useSprints}`;
    if (!velocities.has(key)) {
      velocities.set(
        key,
        velocity({
          items,
          area,
          settings: areaSettings[area],
          today,
          sprints: input.sprints,
          useSprints,
          dateOf,
        }),
      );
    }
    return velocities.get(key) ?? null;
  };
  const forecastOf = (item: RoadmapWorkItem): RoadmapForecast => {
    const settings = settingsOf(item);
    return forecast({
      item,
      byId,
      unit: settings.unit,
      velocity: velocityFor(areaOf(item), item.sprintId !== null),
      today,
      weekdays: settings.workingWeekdays,
    });
  };

  const open = items.filter((entry) => entry.state !== "done");
  const snoozed = open
    .filter((entry) => isSnoozed(entry, today))
    .sort((left, right) =>
      left.snoozedUntil! < right.snoozedUntil!
        ? -1
        : left.snoozedUntil! > right.snoozedUntil!
          ? 1
          : rank(left, right),
    );
  const candidates = open.filter((entry) => !isSnoozed(entry, today));
  // Quiet backlog stays off Today unless the user pinned it or something waits on them.
  const quietBacklog = (item: RoadmapWorkItem) =>
    item.state === "backlog" &&
    item.dueDate === null &&
    ["p2", "p3"].includes(effectivePriority(item.id, byId).priority);

  const placed = new Set<RoadmapItemId>();
  const sectionRows = new Map<
    RoadmapTodaySectionId,
    Array<{ item: RoadmapWorkItem; reason: string; score?: number }>
  >();
  const place = (
    section: RoadmapTodaySectionId,
    item: RoadmapWorkItem,
    reason: string,
    score?: number,
  ) => {
    placed.add(item.id);
    const rows = sectionRows.get(section) ?? [];
    rows.push({ item, reason, ...(score === undefined ? {} : { score }) });
    sectionRows.set(section, rows);
  };

  for (const item of candidates) {
    const signal = threadSignals.get(item.id);
    const reviews = reviewRequests.get(item.id) ?? [];
    const unsure = openUnsureNotes(item);
    const reasons = [
      ...(signal?.awaiting == null ? [] : [AWAITING_TEXT[signal.awaiting.reason]]),
      ...(reviews.length === 0
        ? []
        : [`${plural(reviews.length, "pull request", "pull requests")} to review`]),
      ...(unsure === 0
        ? []
        : [`${plural(unsure, "unsure note", "unsure notes")} from the steward`]),
    ];
    if (reasons.length === 0) continue;
    place("waiting", item, joinReasons(reasons));
  }

  for (const item of candidates) {
    if (placed.has(item.id) || item.pinnedAt === null) continue;
    place("picks", item, "Pinned");
  }

  const eligible = candidates.filter((entry) => !quietBacklog(entry));

  for (const item of eligible) {
    if (placed.has(item.id)) continue;
    const due = item.dueDate;
    const label = (date: IsoDate) => roadmapDayLabel(date, today);
    if (due !== null && due < today) {
      place("due", item, `Overdue, was due ${label(due)}`);
      continue;
    }
    const projection = forecastOf(item);
    const slipping = projection.status === "at-risk" || projection.status === "late";
    const soon =
      due !== null &&
      workingDaysBetween(today, due, settingsOf(item).workingWeekdays) <= DUE_SOON_WORKING_DAYS;
    if (due === null || (!soon && !slipping)) continue;
    const dueText = due === today ? "Due today" : `Due ${label(due)}`;
    if (!slipping) {
      place("due", item, dueText);
    } else if (projection.projected !== null && projection.projected !== due) {
      place(
        "due",
        item,
        `${dueText}, forecast ${label(projection.projected)}, ${projection.status === "late" ? "late" : "at risk"}`,
      );
    } else {
      place("due", item, `${dueText}, ${projection.status === "late" ? "late" : "at risk"}`);
    }
  }

  for (const item of eligible) {
    if (placed.has(item.id)) continue;
    const priority = effectivePriority(item.id, byId).priority;
    if (priority !== "p0" && priority !== "p1") continue;
    // A parent is as warm as the busiest work under it.
    let latest = lastActivityAt(item, threadSignals);
    for (const entry of subtreeOf(item, byId)) {
      const activity = lastActivityAt(entry, threadSignals);
      if (Date.parse(activity) > Date.parse(latest)) latest = activity;
    }
    const settings = settingsOf(item);
    const idle = workingDaysBetween(dateOf(latest), today, settings.workingWeekdays);
    if (idle < settings.goingColdDays) continue;
    place(
      "cold",
      item,
      `${priority.toUpperCase()}, untouched ${plural(idle, "working day", "working days")}`,
    );
  }

  const since =
    input.lastOpenedAt === null
      ? Date.parse(input.now) - NEVER_OPENED_LOOKBACK_MS
      : Date.parse(input.lastOpenedAt);
  for (const item of eligible) {
    if (placed.has(item.id)) continue;
    if (item.blockedBy.length === 0 && item.externalBlockers.length === 0) continue;
    let lastCleared: { at: number; text: string } | null = null;
    let stillBlocked = false;
    for (const blockerId of item.blockedBy) {
      const blocker = byId.get(blockerId);
      // A deleted blocker no longer blocks, but leaves no time to compare.
      if (blocker === undefined) continue;
      if (blocker.state !== "done" || blocker.completedAt === null) {
        stillBlocked = stillBlocked || blocker.state !== "done";
        continue;
      }
      const clearedAt = Date.parse(blocker.completedAt);
      if (lastCleared === null || clearedAt > lastCleared.at) {
        lastCleared = { at: clearedAt, text: `${blocker.title} done` };
      }
    }
    for (const blocker of item.externalBlockers) {
      if (blocker.resolvedAt === null) {
        stillBlocked = true;
        continue;
      }
      const clearedAt = Date.parse(blocker.resolvedAt);
      if (lastCleared === null || clearedAt > lastCleared.at) {
        lastCleared = { at: clearedAt, text: `${blocker.text} resolved` };
      }
    }
    if (stillBlocked || lastCleared === null || lastCleared.at <= since) continue;
    place("unblocked", item, `Unblocked, ${lastCleared.text}`);
  }

  const blocking = new Map<RoadmapItemId, Array<RoadmapWorkItem>>();
  for (const item of open) {
    for (const blockerId of item.blockedBy) {
      const list = blocking.get(blockerId) ?? [];
      list.push(item);
      blocking.set(blockerId, list);
    }
  }
  for (const item of eligible) {
    if (placed.has(item.id)) continue;
    const waiting = blocking.get(item.id) ?? [];
    if (waiting.length === 0) continue;
    const weekdays = settingsOf(item).workingWeekdays;
    // Each blocked item counts one, plus up to one more the sooner it is due.
    const score = waiting.reduce((sum, blocked) => {
      if (blocked.dueDate === null) return sum + 1;
      const daysLeft = Math.max(0, workingDaysBetween(today, blocked.dueDate, weekdays));
      return sum + 1 + 1 / (1 + daysLeft);
    }, 0);
    const nextDue = waiting
      .flatMap((blocked) => (blocked.dueDate === null ? [] : [blocked.dueDate]))
      .sort()[0];
    place(
      "holding",
      item,
      `Blocks ${waiting.length}${nextDue === undefined ? "" : `, next due ${roadmapDayLabel(nextDue, today)}`}`,
      score,
    );
  }

  // Capacity: fill rows in display order per area until a day's velocity is used.
  const capacity = Object.fromEntries(
    AREAS.map((area) => {
      const perDay = velocityFor(area, false)?.perDay ?? null;
      return [area, { area, unit: areaSettings[area].unit, perDay, used: 0 }];
    }),
  ) as Record<
    RoadmapArea,
    { area: RoadmapArea; unit: RoadmapUnit; perDay: number | null; used: number }
  >;
  const averages = new Map(
    AREAS.map((area) => [
      area,
      averageLeafSize({ items, area, settings: areaSettings[area], today, dateOf }),
    ]),
  );
  const counted = new Set<RoadmapItemId>();

  const sections: RoadmapTodaySection[] = [];
  for (const id of SECTION_ORDER) {
    const entries = sectionRows.get(id);
    if (entries === undefined || entries.length === 0) continue;
    entries.sort((left, right) =>
      id === "holding" && left.score !== right.score
        ? (right.score ?? 0) - (left.score ?? 0)
        : rank(left.item, right.item),
    );
    const rows = entries.map(({ item, reason }): RoadmapTodayRow => {
      const area = areaOf(item);
      const unit = areaSettings[area].unit;
      const leaves = leavesUnder(item, byId).filter((leaf) => leaf.state !== "done");
      const leafRemaining = leaves.map((leaf) => ({ leaf, left: remaining(leaf, byId, unit) }));
      const estimates = leafRemaining.flatMap(({ left }) => (left === null ? [] : [left]));
      const estimate =
        estimates.length === 0 ? null : estimates.reduce((sum, value) => sum + value, 0);
      const noEstimate = leafRemaining.some(({ left }) => left === null);
      if (id === "waiting") {
        return {
          itemId: item.id,
          section: id,
          reason,
          area,
          estimate,
          noEstimate,
          beyondToday: false,
        };
      }
      const budget = capacity[area];
      const beyondToday = id !== "picks" && budget.perDay !== null && budget.used >= budget.perDay;
      if (!beyondToday) {
        for (const { leaf, left } of leafRemaining) {
          if (counted.has(leaf.id)) continue;
          counted.add(leaf.id);
          budget.used += left ?? averages.get(area) ?? 0;
        }
      }
      return { itemId: item.id, section: id, reason, area, estimate, noEstimate, beyondToday };
    });
    sections.push({ id, title: SECTION_TITLES[id], rows });
  }

  return {
    sections,
    capacity,
    snoozed: snoozed.map((entry) => ({ itemId: entry.id, until: entry.snoozedUntil! })),
  };
}
