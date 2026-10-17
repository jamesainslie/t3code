// @effect-diagnostics globalDate:off -- UI snooze presets use local calendar boundaries and Intl labels.
import {
  type ExecutionEnvironmentCapabilities,
  isSyncedThreadId,
  type ThreadDependency,
  type ThreadDependencyHolder,
  type ThreadId,
  threadDependencyWouldCycle,
  unsatisfiedThreadDependencies,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";

import type { PendingSubagentRequest } from "./models.ts";

interface SettlementRunLike {
  readonly turnId?: unknown;
  readonly assistantMessageId?: unknown;
  readonly status?: string;
  readonly state?: string;
  readonly requestedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

interface SettlementRuntimeLike {
  readonly threadId?: unknown;
  readonly providerName?: unknown;
  readonly runtimeMode?: unknown;
  readonly activeTurnId?: unknown;
  readonly lastError?: unknown;
  readonly status: string;
  readonly updatedAt?: string;
}

interface QueuedThreadShell {
  readonly latestUserMessageAt?: string | null;
  readonly latestTurn?: SettlementRunLike | null;
  readonly latestRun?: SettlementRunLike | null;
  readonly session?: SettlementRuntimeLike | null;
  readonly runtime?: SettlementRuntimeLike | null;
}

/**
 * A queued turn start lives for at most this long: session adoption takes
 * seconds, so a user message still unadopted after the grace window is a
 * failed start (or stale data — shells from older servers can carry user
 * messages with no latestTurn at all), not pending work. Without this bound
 * such threads would be permanently unsettleable.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export function hasQueuedTurnStart(
  shell: QueuedThreadShell,
  options: { readonly now: string },
): boolean {
  if (
    shell.runtime?.status === "preparing" ||
    shell.runtime?.status === "queued" ||
    shell.runtime?.status === "starting"
  ) {
    return true;
  }
  if (shell.latestUserMessageAt == null) return false;
  if (shell.session?.status === "error") return false;
  const messageAt = Date.parse(shell.latestUserMessageAt);
  if (Number.isNaN(messageAt)) return false;
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) return false;
  // Bounded on both sides: message timestamps originate on whichever device
  // sent the message, so a clock ahead of this one yields a negative age
  // that would otherwise hold the queued state for the whole skew. Mirrors
  // the decider's guard.
  if (Math.abs(nowMs - messageAt) > QUEUED_TURN_START_GRACE_MS) return false;
  const turn = shell.latestRun ?? shell.latestTurn ?? null;
  if (turn === null) return true;
  return [turn.requestedAt, turn.startedAt, turn.completedAt].every(
    (candidate) => candidate == null || Date.parse(candidate) < messageAt,
  );
}

export interface ThreadSnoozeShell extends QueuedThreadShell {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly pendingSubagentRequest?: PendingSubagentRequest | null;
}

export function threadRaisedHandWhileSnoozed(shell: ThreadSnoozeShell): boolean {
  return threadRaisedHandSince(shell, shell.snoozedAt ?? null);
}

/**
 * The raised-hand rule shared by snooze and "depends on": pending approval
 * or input, a session error newer than `referenceAt`, or a turn that
 * completed after it. Only a FRESH failure counts: a thread parked while
 * already failed stays parked, since parking it was the user saying "I saw
 * it, not now". session.updatedAt stamps the status edge.
 */
function threadRaisedHandSince(shell: ThreadRaisedHandShell, referenceAt: string | null): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return true;
  if (shell.pendingSubagentRequest != null) return true;
  const runtime = shell.runtime ?? shell.session ?? null;
  const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
  if (
    (runtime?.status === "error" || runtime?.status === "failed") &&
    (referenceAt == null ||
      (runtime.updatedAt != null && Date.parse(runtime.updatedAt) > Date.parse(referenceAt)))
  ) {
    return true;
  }
  if (
    referenceAt != null &&
    (latestRun?.state === "completed" || latestRun?.status === "completed") &&
    latestRun.completedAt != null &&
    Date.parse(latestRun.completedAt) > Date.parse(referenceAt)
  ) {
    return true;
  }
  return false;
}

// "Depends on": the other overlay on the active lifecycle. A thread with an
// open link waits in the Depends on shelf until the server marks every link
// satisfied (the dependency finished, errored, asked, or went away) or the
// thread raises its own hand. Nothing here is derived from the dependency's
// live state: satisfaction is a persisted fact, so the classification never
// flips back when the dependency starts its next turn.

type ThreadRaisedHandShell = Pick<
  ThreadSnoozeShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "latestTurn"
  | "latestRun"
  | "session"
  | "runtime"
>;

export type ThreadDependencyShell = ThreadRaisedHandShell & ThreadDependencyHolder;

function latestLinkedAt(links: ReadonlyArray<ThreadDependency>): string | null {
  let latest: string | null = null;
  for (const link of links) {
    if (latest === null || Date.parse(link.linkedAt) > Date.parse(latest)) latest = link.linkedAt;
  }
  return latest;
}

/** The time the newest open link was made, the reference for a raised hand. */
function latestDependencyLinkedAt(shell: ThreadDependencyHolder): string | null {
  return latestLinkedAt(unsatisfiedThreadDependencies(shell));
}

/** Blocked: at least one open link and no raised hand since the newest one. */
export function effectiveBlocked(shell: ThreadDependencyShell): boolean {
  const open = unsatisfiedThreadDependencies(shell);
  if (open.length === 0) return false;
  return !threadRaisedHandSince(shell, latestLinkedAt(open));
}

/**
 * When a thread that waited on other threads came back, or null if it never
 * waited or is still waiting. Feeds the same Woke indicator as
 * threadWokeAt: the later of the two wins on the row.
 */
export function threadUnblockedAt(shell: ThreadDependencyShell): string | null {
  const links = shell.dependencies ?? [];
  if (links.length === 0) return null;
  const open = links.filter((link) => link.satisfiedAt === null);
  if (open.length > 0) {
    const referenceAt = latestLinkedAt(open);
    if (!threadRaisedHandSince(shell, referenceAt)) return null;
    const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
    if (
      referenceAt != null &&
      (latestRun?.state === "completed" || latestRun?.status === "completed") &&
      latestRun.completedAt != null &&
      Date.parse(latestRun.completedAt) > Date.parse(referenceAt)
    ) {
      return latestRun.completedAt;
    }
    return (shell.runtime ?? shell.session)?.updatedAt ?? referenceAt;
  }
  let latest: string | null = null;
  for (const link of links) {
    if (
      link.satisfiedAt !== null &&
      (latest === null || Date.parse(link.satisfiedAt) > Date.parse(latest))
    ) {
      latest = link.satisfiedAt;
    }
  }
  return latest;
}

/**
 * A thread may wait on another unless the same things that block snooze
 * apply, or it is a synced conversation owned by another environment.
 */
export function canAddDependency(
  shell: Parameters<typeof canSnooze>[0] & { readonly id: ThreadId },
  options: { readonly now: string },
): boolean {
  if (isSyncedThreadId(shell.id)) return false;
  return canSnooze(shell, options);
}

/**
 * Whether `candidate` may be offered as a dependency for `blocked`: not
 * itself, not archived or synced, not already linked, and not a cycle.
 * Shared by the web and mobile pickers.
 */
export function isDependencyCandidate(
  threads: ReadonlyArray<ThreadDependencyHolder & { readonly id: ThreadId }>,
  blocked: ThreadDependencyHolder & { readonly id: ThreadId },
  candidate: { readonly id: ThreadId; readonly archivedAt: string | null },
): boolean {
  if (candidate.id === blocked.id) return false;
  if (candidate.archivedAt !== null) return false;
  if (isSyncedThreadId(candidate.id)) return false;
  if (unsatisfiedThreadDependencies(blocked).some((link) => link.threadId === candidate.id)) {
    return false;
  }
  return !threadDependencyWouldCycle(threads, blocked.id, candidate.id);
}

/** Row copy for a waiting thread: "Waiting on {title}" or "Waiting on N threads". */
export function dependencyWaitLabel(
  shell: ThreadDependencyHolder,
  resolveTitle: (threadId: ThreadDependency["threadId"]) => string | null,
): string | null {
  const open = unsatisfiedThreadDependencies(shell);
  if (open.length === 0) return null;
  if (open.length > 1) return `Waiting on ${open.length} threads`;
  const title = resolveTitle(open[0]!.threadId);
  return title === null ? "Waiting on another thread" : `Waiting on ${title}`;
}

/** Shelf order: the most recently parked thread first. */
export function compareBlockedThreads(
  left: ThreadDependencyHolder,
  right: ThreadDependencyHolder,
): number {
  const leftAt = latestDependencyLinkedAt(left);
  const rightAt = latestDependencyLinkedAt(right);
  if (leftAt === rightAt) return 0;
  if (leftAt === null) return 1;
  if (rightAt === null) return -1;
  return Date.parse(rightAt) - Date.parse(leftAt);
}

export function canSnooze(
  shell: Pick<
    ThreadSnoozeShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "pendingSubagentRequest"
    | "latestUserMessageAt"
    | "latestTurn"
    | "latestRun"
    | "session"
    | "runtime"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return false;
  if (shell.pendingSubagentRequest != null) return false;
  if (hasQueuedTurnStart(shell, options)) return false;
  return true;
}

export function effectiveSnoozed(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): boolean {
  if (shell.snoozedUntil == null) return false;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return false;
  if (wakeAtMs <= Date.parse(options.now)) return false;
  return !threadRaisedHandWhileSnoozed(shell);
}

export function threadWokeAt(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): string | null {
  if (shell.snoozedUntil == null) return null;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return null;
  // An early hand-raise wake stays authoritative even after the scheduled
  // wake time passes: reporting snoozedUntil then would resurface a Woke
  // indicator the user already cleared by visiting (snoozedUntil is newer
  // than that visit's lastVisitedAt).
  if (threadRaisedHandWhileSnoozed(shell)) {
    const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
    const runtime = shell.runtime ?? shell.session ?? null;
    if (
      shell.snoozedAt != null &&
      (latestRun?.state === "completed" || latestRun?.status === "completed") &&
      latestRun.completedAt != null &&
      Date.parse(latestRun.completedAt) > Date.parse(shell.snoozedAt)
    ) {
      return latestRun.completedAt;
    }
    return runtime?.updatedAt ?? shell.snoozedAt ?? null;
  }
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

const HOUR_MS = 60 * 60 * 1_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

export type SnoozePresetId = "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";

export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  readonly whenLabel: string;
  readonly snoozedUntil: string;
}

function snoozeTimeOfDayLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function snoozeAtHour(base: Date, hour: number): Date {
  const next = DateTime.toDate(DateTime.makeUnsafe(base));
  next.setHours(hour, 0, 0, 0);
  return next;
}

// Calendar-day advance instead of adding DAY_MS: fixed millisecond offsets
// land on the wrong local day across DST transitions (a spring-forward day
// is 23 hours, so 23:30 + 24h skips the whole next day).
function addSnoozeDays(base: Date, days: number): Date {
  const next = DateTime.toDate(DateTime.makeUnsafe(base));
  next.setDate(next.getDate() + days);
  return next;
}

export function resolveSnoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  const inAnHour = DateTime.toDate(DateTime.makeUnsafe(now.getTime() + HOUR_MS));
  const inThreeHours = DateTime.toDate(DateTime.makeUnsafe(now.getTime() + 3 * HOUR_MS));
  const presets: SnoozePreset[] = [
    {
      id: "hour",
      label: "In 1 hour",
      whenLabel: snoozeTimeOfDayLabel(inAnHour),
      snoozedUntil: inAnHour.toISOString(),
    },
    {
      id: "three-hours",
      label: "In 3 hours",
      whenLabel: snoozeTimeOfDayLabel(inThreeHours),
      snoozedUntil: inThreeHours.toISOString(),
    },
  ];

  const evening = snoozeAtHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: "evening",
      label: "This evening",
      whenLabel: snoozeTimeOfDayLabel(evening),
      snoozedUntil: evening.toISOString(),
    });
  }

  const tomorrow = snoozeAtHour(addSnoozeDays(now, 1), MORNING_HOUR);
  presets.push({
    id: "tomorrow",
    label: "Tomorrow",
    whenLabel: snoozeTimeOfDayLabel(tomorrow),
    snoozedUntil: tomorrow.toISOString(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = snoozeAtHour(addSnoozeDays(now, daysUntilMonday), MORNING_HOUR);
  if (nextWeek.getTime() !== tomorrow.getTime()) {
    presets.push({
      id: "next-week",
      label: "Next week",
      whenLabel: `${nextWeek.toLocaleDateString(undefined, { weekday: "short" })} ${snoozeTimeOfDayLabel(nextWeek)}`,
      snoozedUntil: nextWeek.toISOString(),
    });
  }

  return presets;
}

export function snoozeWakeLabel(snoozedUntil: string, options: { readonly now: string }): string {
  const wakeMs = Date.parse(snoozedUntil);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(wakeMs) || Number.isNaN(nowMs)) return "now";
  const remainingMs = wakeMs - nowMs;
  if (remainingMs <= 0) return "now";
  if (remainingMs < HOUR_MS) return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
  if (remainingMs < DAY_MS) return `${Math.ceil(remainingMs / HOUR_MS)}h`;
  return `${Math.ceil(remainingMs / DAY_MS)}d`;
}

/**
 * The note in effect after a snooze, mirroring the server decider so the
 * optimistic preview matches the confirmed shell. No reminder keeps the note
 * of a pending snooze (preset re-snoozes must not drop it), a blank one
 * clears it, and anything else replaces it.
 */
export function resolveSnoozeReminder(
  thread: {
    readonly snoozedUntil?: string | null | undefined;
    readonly snoozeReminder?: string | null | undefined;
  },
  reminder: string | undefined,
): string | null {
  if (reminder === undefined) {
    return thread.snoozedUntil != null ? (thread.snoozeReminder ?? null) : null;
  }
  return reminder.trim() || null;
}

/** Whether the server accepts a reminder on thread.snooze. Missing means an
    older server, which must never be offered the reminder controls. */
export function supportsSnoozeReminder(
  capabilities: Pick<ExecutionEnvironmentCapabilities, "threadSnoozeReminder"> | null | undefined,
): boolean {
  return capabilities?.threadSnoozeReminder === true;
}

export type CustomSnoozeInput =
  | { readonly mode: "date"; readonly date: string; readonly time: string }
  | {
      readonly mode: "duration";
      readonly amount: string;
      readonly unit: "minutes" | "hours" | "days";
    };

export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date): string | null {
  let wake: Date;
  if (input.mode === "duration") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unitMs = { minutes: 60_000, hours: HOUR_MS, days: 24 * HOUR_MS }[input.unit];
    wake = new Date(now.getTime() + amount * unitMs);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null;
    wake = new Date(`${input.date}T${input.time}:00`);
    // Reject rolled-over dates and nonexistent local times during DST changes.
    if (localSnoozeDate(wake) !== input.date || localSnoozeTime(wake) !== input.time) return null;
  }
  return Number.isFinite(wake.getTime()) && wake.getTime() > now.getTime()
    ? wake.toISOString()
    : null;
}

export function localSnoozeDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localSnoozeTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
