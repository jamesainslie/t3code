/**
 * Fork: roadmap. Pure helpers for the Today tab: the thread and pull request
 * signals `buildToday` reads, snooze dates, and the text the tab shows.
 */
import { scopedThreadKey } from "@lathe/client-runtime/environment";
import type {
  RoadmapAwaitingReason,
  RoadmapReviewRequests,
  RoadmapThreadSignal,
  RoadmapThreadSignals,
  RoadmapTodayCapacity,
  RoadmapTodayRow,
  RoadmapTodaySection,
} from "@lathe/client-runtime/roadmap/today";
import type { EnvironmentThreadShell } from "@lathe/client-runtime/state/models";
import {
  type EnvironmentId,
  type IsoDate,
  isRoadmapError,
  type ProjectId,
  type PullRequestListEntry,
  type PullRequestListInput,
  type RoadmapArea,
  type RoadmapItemId,
  type RoadmapThreadRef,
  type RoadmapUnit,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { addDays } from "@lathe/shared/roadmapCalc";

import { hasUnseenCompletion, resolveThreadLastVisitedAt } from "../Sidebar.logic";
import { ROADMAP_AREA_LABELS, ROADMAP_AREAS } from "./roadmap.logic";

/** What Today needs from one attached thread's shell. */
export interface RoadmapTodayThread {
  readonly ref: RoadmapThreadRef;
  readonly projectId: ProjectId;
  readonly latestActivityAt: string | null;
  readonly awaiting: RoadmapAwaitingReason | null;
  readonly pullRequestUrls: ReadonlyArray<string>;
}

export const roadmapTodayThreadKey = (thread: RoadmapThreadRef) => scopedThreadKey(thread);

/** Threads attached to open items, once each, in a stable order so subscriptions stay put. */
export function roadmapTodayThreadRefs(
  items: ReadonlyArray<RoadmapWorkItem>,
): ReadonlyArray<RoadmapThreadRef> {
  const byKey = new Map<string, RoadmapThreadRef>();
  for (const item of items) {
    if (item.state === "done") continue;
    for (const { thread } of item.attachments) byKey.set(roadmapTodayThreadKey(thread), thread);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, thread]) => thread);
}

const later = (left: string | null, right: string | null) => {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
};

/**
 * The sidebar's "Waiting" status is the agent waiting on its own background
 * work, so it never counts here; only what needs the user does.
 */
export function roadmapTodayThreadOf(
  shell: EnvironmentThreadShell,
  localLastVisitedAt: string | undefined,
): RoadmapTodayThread {
  const lastVisitedAt = resolveThreadLastVisitedAt(shell.lastVisitedAt, localLastVisitedAt);
  const awaiting: RoadmapAwaitingReason | null =
    shell.archivedAt !== null || shell.deletedAt !== null
      ? null
      : shell.hasPendingApprovals
        ? "approval"
        : shell.hasPendingUserInput
          ? "user-input"
          : shell.hasActionableProposedPlan
            ? "plan-ready"
            : hasUnseenCompletion({ ...shell, lastVisitedAt })
              ? "turn-finished"
              : null;
  const pullRequestUrls = shell.pullRequests
    .filter((link) => link.source !== "stack-dismissed")
    .map((link) => link.url);
  const linked = shell.linkedPullRequest?.url;
  if (linked !== undefined && !pullRequestUrls.includes(linked)) pullRequestUrls.push(linked);
  return {
    ref: { environmentId: shell.environmentId, threadId: shell.id },
    projectId: shell.projectId,
    latestActivityAt: later(
      shell.latestRun?.completedAt ?? null,
      shell.latestUserAuthoredMessageAt ?? null,
    ),
    awaiting,
    pullRequestUrls,
  };
}

const AWAITING_RANK: Readonly<Record<RoadmapAwaitingReason, number>> = {
  approval: 0,
  "user-input": 1,
  "plan-ready": 2,
  "turn-finished": 3,
};

/** Per item, across its attached threads: the latest activity and the most urgent wait. */
export function roadmapThreadSignals(
  items: ReadonlyArray<RoadmapWorkItem>,
  threads: ReadonlyMap<string, RoadmapTodayThread>,
): RoadmapThreadSignals {
  const signals = new Map<RoadmapItemId, RoadmapThreadSignal>();
  for (const item of items) {
    let latestActivityAt: string | null = null;
    let awaiting: RoadmapThreadSignal["awaiting"] = null;
    let known = false;
    for (const { thread: ref } of item.attachments) {
      const thread = threads.get(roadmapTodayThreadKey(ref));
      if (thread === undefined) continue;
      known = true;
      latestActivityAt = later(latestActivityAt, thread.latestActivityAt);
      if (
        thread.awaiting !== null &&
        (awaiting === null || AWAITING_RANK[thread.awaiting] < AWAITING_RANK[awaiting.reason])
      ) {
        awaiting = { reason: thread.awaiting, thread: ref };
      }
    }
    if (known) signals.set(item.id, { latestActivityAt, awaiting });
  }
  return signals;
}

export interface RoadmapReviewTarget {
  readonly environmentId: EnvironmentId;
  readonly input: PullRequestListInput;
}

/**
 * One review-requested listing per environment, narrowed to the projects whose
 * attached threads link a pull request, since nothing else can join an item.
 */
export function roadmapReviewTargets(
  threads: Iterable<RoadmapTodayThread>,
): ReadonlyArray<RoadmapReviewTarget> {
  const projects = new Map<EnvironmentId, Set<ProjectId>>();
  for (const thread of threads) {
    if (thread.pullRequestUrls.length === 0) continue;
    const set = projects.get(thread.ref.environmentId) ?? new Set();
    set.add(thread.projectId);
    projects.set(thread.ref.environmentId, set);
  }
  return [...projects.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([environmentId, ids]) => ({
      environmentId,
      input: {
        state: "open",
        involvement: "reviewing",
        projectIds: [...ids].sort(),
      },
    }));
}

/** Hosts differ in case and trailing slashes between a link and a listing. */
const normalizeUrl = (url: string) => url.trim().toLowerCase().replace(/\/+$/, "");

export function roadmapReviewRequests(
  items: ReadonlyArray<RoadmapWorkItem>,
  threads: ReadonlyMap<string, RoadmapTodayThread>,
  entries: ReadonlyArray<Pick<PullRequestListEntry, "url" | "state" | "viewerReviewRequested">>,
): RoadmapReviewRequests {
  const waiting = new Map<string, string>();
  for (const entry of entries) {
    if (entry.state === "open" && entry.viewerReviewRequested) {
      waiting.set(normalizeUrl(entry.url), entry.url);
    }
  }
  const requests = new Map<RoadmapItemId, ReadonlyArray<string>>();
  if (waiting.size === 0) return requests;
  for (const item of items) {
    const urls = new Set<string>();
    for (const { thread: ref } of item.attachments) {
      for (const url of threads.get(roadmapTodayThreadKey(ref))?.pullRequestUrls ?? []) {
        const match = waiting.get(normalizeUrl(url));
        if (match !== undefined) urls.add(match);
      }
    }
    if (urls.size > 0) requests.set(item.id, [...urls]);
  }
  return requests;
}

// Dates and text

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTHS = [
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

const partsOf = (date: IsoDate) => {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return { weekday, month: MONTHS[month! - 1]!, day: day! };
};

/** "Monday, Oct 19". */
export function todayHeaderDate(today: IsoDate): string {
  const { weekday, month, day } = partsOf(today);
  return `${WEEKDAYS[weekday]}, ${month} ${day}`;
}

/** "Tue, Oct 20". */
export function todayShortDate(date: IsoDate): string {
  const { weekday, month, day } = partsOf(date);
  return `${WEEKDAYS[weekday]!.slice(0, 3)}, ${month} ${day}`;
}

export type RoadmapSnoozeChoiceId = "tomorrow" | "next-monday" | "week";

export interface RoadmapSnoozeChoice {
  readonly id: RoadmapSnoozeChoiceId;
  readonly label: string;
  readonly until: IsoDate;
  /** The date the item comes back, such as "Tue, Oct 20". */
  readonly hint: string;
}

/** Work items snooze to a date; each choice is after today, as the planner requires. */
export function roadmapSnoozeChoices(today: IsoDate): ReadonlyArray<RoadmapSnoozeChoice> {
  const weekday = partsOf(today).weekday;
  // Monday is 1; from a Monday the next one is a week out.
  const toMonday = (1 - weekday + 7) % 7 || 7;
  const choice = (id: RoadmapSnoozeChoiceId, label: string, days: number): RoadmapSnoozeChoice => {
    const until = addDays(today, days);
    return { id, label, until, hint: todayShortDate(until) };
  };
  return [
    choice("tomorrow", "Tomorrow", 1),
    choice("next-monday", "Next Monday", toMonday),
    choice("week", "In a week", 7),
  ];
}

const UNIT_WORDS: Readonly<Record<RoadmapUnit, readonly [string, string]>> = {
  points: ["pt", "pts"],
  hours: ["h", "h"],
  items: ["item", "items"],
  criteria: ["criterion", "criteria"],
};

/** "5 pts", "1 criterion"; one decimal at most, since velocity is an average. */
export function roadmapUnitAmount(amount: number, unit: RoadmapUnit): string {
  const rounded = Math.round(amount * 10) / 10;
  const [one, many] = UNIT_WORDS[unit];
  return `${rounded} ${rounded === 1 ? one : many}`;
}

/** "capacity Work 5 pts, Personal 4 pts"; an area without enough history has no line. */
export function todayCapacityText(
  capacity: Readonly<Record<RoadmapArea, RoadmapTodayCapacity>>,
): string | null {
  const parts = ROADMAP_AREAS.flatMap((area) => {
    const { perDay, unit } = capacity[area];
    return perDay === null
      ? []
      : [`${ROADMAP_AREA_LABELS[area]} ${roadmapUnitAmount(perDay, unit)}`];
  });
  return parts.length === 0 ? null : `capacity ${parts.join(", ")}`;
}

export function todayEstimateText(
  row: Pick<RoadmapTodayRow, "estimate" | "noEstimate">,
  unit: RoadmapUnit,
): { readonly amount: string | null; readonly hint: string | null } {
  const amount = row.estimate === null ? null : roadmapUnitAmount(row.estimate, unit);
  const hint = !row.noEstimate ? null : amount === null ? "no estimate" : "part unestimated";
  return { amount, hint };
}

export type TodayReasonTone = "destructive" | "warning" | "muted";

/** Reads `buildToday`'s fixed wording for the due section. */
export function todayReasonTone(row: Pick<RoadmapTodayRow, "section" | "reason">): TodayReasonTone {
  if (row.section !== "due") return "muted";
  if (row.reason.startsWith("Overdue")) return "destructive";
  if (/, (late|at risk)$/.test(row.reason)) return "warning";
  return "muted";
}

/** A thread waiting on the user is the one to open; otherwise the user picks among them. */
export function todayOpenThreads(
  item: Pick<RoadmapWorkItem, "attachments">,
  signal: RoadmapThreadSignal | undefined,
): ReadonlyArray<RoadmapThreadRef> {
  if (signal?.awaiting != null) return [signal.awaiting.thread];
  return item.attachments.map((attachment) => attachment.thread);
}

export interface TodaySplit {
  readonly above: ReadonlyArray<RoadmapTodaySection>;
  /** Rows past the capacity line, grouped by section, shown dimmed below one divider. */
  readonly beyond: ReadonlyArray<RoadmapTodaySection>;
}

export function splitTodayAtCapacity(sections: ReadonlyArray<RoadmapTodaySection>): TodaySplit {
  const part = (beyond: boolean) =>
    sections.flatMap((section) => {
      const rows = section.rows.filter((row) => row.beyondToday === beyond);
      return rows.length === 0 ? [] : [{ ...section, rows }];
    });
  return { above: part(false), beyond: part(true) };
}

export function roadmapPinFailure(error: unknown): {
  readonly title: string;
  readonly description: string;
} {
  if (isRoadmapError(error) && error.code === "pin_limit") {
    return { title: "Today already has three picks", description: error.message };
  }
  return {
    title: "Could not pin",
    description: error instanceof Error ? error.message : String(error),
  };
}

export const todayLastOpenedStorageKey = (home: EnvironmentId) =>
  `lathe:roadmap:today-last-opened:${home}`;

export function parseTodayLastOpenedAt(raw: string | null): string | null {
  return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

export interface TodayLastOpenedStore {
  readonly read: (home: EnvironmentId) => string | null;
  readonly write: (home: EnvironmentId, at: string) => void;
}

/**
 * The "Newly unblocked" baseline for each home, fixed for one page load. Today remounts on every
 * roadmap tab switch, so recording each mount as the last visit would compare against a moment
 * ago and drop everything just shown. Only a page load's first visit reads and records the time.
 */
export function createTodayBaselines(
  store: TodayLastOpenedStore,
): (home: EnvironmentId, now: string) => string | null {
  const baselines = new Map<EnvironmentId, string | null>();
  return (home, now) => {
    if (baselines.has(home)) return baselines.get(home) ?? null;
    const baseline = store.read(home);
    baselines.set(home, baseline);
    store.write(home, now);
    return baseline;
  };
}
