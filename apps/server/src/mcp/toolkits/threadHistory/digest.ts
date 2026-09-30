import type {
  OrchestrationCheckpointFile,
  OrchestrationThread,
  OrchestrationThreadActivity,
  ThreadId,
} from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

import { cutToBytes } from "./text.ts";
import {
  isErrorActivity,
  isTurnFailure,
  reconstructTurns,
  type DigestTurnState,
  type ReconstructedTurn,
} from "./turns.ts";

export const DIGEST_LIMITS = {
  budgetBytes: 24_576,
  goalBytes: 4_096,
  steeringBytes: 500,
  earlierTurnBytes: 150,
  /** Ceiling for one user or assistant message in a detailed turn; the render budget does the rest. */
  detailMessageBytes: 8_192,
  toolDetailBytes: 300,
  excerptBytes: 300,
  contextFullRatio: 0.95,
} as const;

/** The only activity a digest reads per turn, loaded just for the turns shown in detail. */
export const DIGEST_TOOL_ACTIVITY_KIND = "tool.completed";

/**
 * Every other activity kind a digest reads: turn errors (any error-tone kind), plan updates,
 * and context readings. Tool and task progress rows, the bulk of a thread's payloads, are left out.
 */
export const DIGEST_ACTIVITY_KINDS = [
  "runtime.error",
  "provider.turn.start.failed",
  "provider.turn.interrupt.failed",
  "provider.approval.respond.failed",
  "provider.user-input.respond.failed",
  "provider.session.stop.failed",
  "tool.denied",
  "task.updated",
  "task.completed",
  "turn.plan.updated",
  "context-window.updated",
  "context-compaction",
];

/** Index of the first turn a digest shows in detail. */
export const recentStart = (turnCount: number, recentTurns: number) =>
  Math.max(0, turnCount - Math.max(0, recentTurns));

export type ThreadDigestStatus =
  | { readonly kind: "empty" }
  | { readonly kind: "running" }
  | { readonly kind: "completed" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "context-full"; readonly usedTokens: number; readonly maxTokens: number };

export interface DigestTurnDetail {
  readonly n: number;
  readonly state: DigestTurnState;
  readonly user: string;
  readonly assistant: ReadonlyArray<string>;
  readonly tools: ReadonlyArray<string>;
  readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
  readonly errors: ReadonlyArray<string>;
}

export interface DigestTurnSummary {
  readonly n: number;
  readonly state: DigestTurnState;
  readonly outcome: string;
  readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
}

export interface ThreadDigest {
  readonly header: {
    readonly threadId: ThreadId;
    readonly title: string;
    readonly projectTitle: string | null;
    readonly provider: string | null;
    readonly model: string;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly worktreeRelation: "shared" | "different" | "none";
    readonly createdAt: string;
    readonly lastActivityAt: string;
    readonly status: ThreadDigestStatus;
    /** The thread this one continues. Its title is null when the source can no longer be read. */
    readonly continuedFrom: { readonly threadId: ThreadId; readonly title: string | null } | null;
  };
  readonly goal: string | null;
  readonly steering: ReadonlyArray<{ readonly turn: number; readonly text: string }>;
  readonly openWork: {
    readonly todos: ReadonlyArray<string>;
    readonly plans: ReadonlyArray<{ readonly id: string; readonly excerpt: string }>;
    readonly comments: ReadonlyArray<{ readonly file: string; readonly text: string }>;
    readonly pullRequests: ReadonlyArray<{
      readonly number: number;
      readonly state: string;
      readonly url: string;
    }>;
  };
  readonly earlierTurns: ReadonlyArray<DigestTurnSummary>;
  readonly recentTurns: ReadonlyArray<DigestTurnDetail>;
}

const payloadOf = (activity: OrchestrationThreadActivity) =>
  Predicate.isObject(activity.payload) ? activity.payload : undefined;

const stringOrUndefined = (value: unknown) => (Predicate.isString(value) ? value : undefined);

/** `tool.completed` payloads carry `{ itemType, status, detail, data: { toolName } }`. */
function toolLine(activity: OrchestrationThreadActivity): string {
  const payload = payloadOf(activity);
  const data = Predicate.isObject(payload?.data) ? payload.data : undefined;
  const name =
    stringOrUndefined(data?.toolName) ?? stringOrUndefined(payload?.itemType) ?? activity.summary;
  const status = stringOrUndefined(payload?.status);
  const detail = stringOrUndefined(payload?.detail);
  const head = status ? `${name} ${status}` : name;
  return cutToBytes(detail ? `${head}: ${detail}` : head, DIGEST_LIMITS.toolDetailBytes);
}

/** Runtime errors carry `message`; failed provider commands carry `{ detail, requestId }`. */
function errorText(activity: OrchestrationThreadActivity): string {
  const payload = payloadOf(activity);
  return (
    stringOrUndefined(payload?.message) ?? stringOrUndefined(payload?.detail) ?? activity.summary
  );
}

const nonEmptyTexts = (messages: ReconstructedTurn["assistantMessages"]) =>
  messages.map((message) => message.text).filter((text) => text.trim().length > 0);

export function toTurnDetail(turn: ReconstructedTurn): DigestTurnDetail {
  return {
    n: turn.n,
    state: turn.state,
    user: cutToBytes(
      turn.userMessages.map((message) => message.text).join("\n\n"),
      DIGEST_LIMITS.detailMessageBytes,
    ),
    assistant: nonEmptyTexts(turn.assistantMessages).map((text) =>
      cutToBytes(text, DIGEST_LIMITS.detailMessageBytes),
    ),
    tools: turn.activities
      .filter((activity) => activity.kind === DIGEST_TOOL_ACTIVITY_KIND)
      .map(toolLine),
    files: turn.checkpoint?.files ?? [],
    errors: turn.activities
      .filter(isErrorActivity)
      .map((activity) => cutToBytes(errorText(activity), DIGEST_LIMITS.excerptBytes)),
  };
}

/** The outcome is the turn's last assistant message, or its last error when it never replied. */
function toTurnSummary(turn: ReconstructedTurn): DigestTurnSummary {
  const lastError = turn.activities.findLast(isErrorActivity);
  const outcome =
    nonEmptyTexts(turn.assistantMessages).at(-1) ??
    (lastError ? errorText(lastError) : undefined) ??
    "";
  return {
    n: turn.n,
    state: turn.state,
    outcome: cutToBytes(outcome, DIGEST_LIMITS.earlierTurnBytes),
    files: turn.checkpoint?.files ?? [],
  };
}

/**
 * The last context reading, or nothing when a compaction came after it. Skips unreadable rows,
 * as the context meter does, so they never shadow a valid reading.
 */
function lastContextWindow(activities: OrchestrationThread["activities"]) {
  for (const activity of activities.toReversed()) {
    if (activity.kind === "context-compaction") return undefined;
    if (activity.kind !== "context-window.updated") continue;
    const payload = payloadOf(activity);
    const usedTokens = payload?.usedTokens;
    const maxTokens = payload?.maxTokens;
    if (!Predicate.isNumber(usedTokens) || !Number.isFinite(usedTokens) || usedTokens < 0) continue;
    if (!Predicate.isNumber(maxTokens) || !Number.isFinite(maxTokens) || maxTokens <= 0) continue;
    return { usedTokens, maxTokens };
  }
  return undefined;
}

function deriveStatus(
  thread: OrchestrationThread,
  turns: ReadonlyArray<ReconstructedTurn>,
): ThreadDigestStatus {
  const latest = thread.latestTurn;
  if (latest?.state === "running") return { kind: "running" };
  if (turns.length === 0) return { kind: "empty" };

  // A queued message whose send failed never gets a turn, only a turn-less failure activity.
  const queued = turns.at(-1)?.state === "queued" ? turns.at(-1) : undefined;
  const queuedAt = queued?.userMessages.at(-1)?.createdAt;
  const sendFailure =
    queuedAt === undefined
      ? undefined
      : thread.activities.findLast(
          (activity) =>
            activity.kind === "provider.turn.start.failed" &&
            activity.turnId === null &&
            activity.createdAt >= queuedAt,
        );
  if (sendFailure) {
    return {
      kind: "error",
      message: cutToBytes(errorText(sendFailure), DIGEST_LIMITS.excerptBytes),
    };
  }

  // The latest turn's recorded state wins; without one, the last turn that ran stands in.
  const current = latest
    ? turns.find((entry) => entry.turnId === latest.turnId)
    : turns.findLast((entry) => entry.state !== "queued");
  const state = latest?.state ?? current?.state ?? "completed";

  const usage = lastContextWindow(thread.activities);
  if (usage && usage.usedTokens / usage.maxTokens >= DIGEST_LIMITS.contextFullRatio) {
    return { kind: "context-full", ...usage };
  }
  if (state === "error") {
    // What failed the turn explains it better than a denial or task failure logged after it.
    const lastError =
      current?.activities.findLast(isTurnFailure) ?? current?.activities.findLast(isErrorActivity);
    const message =
      (lastError ? errorText(lastError) : undefined) ?? thread.session?.lastError ?? "Turn failed";
    return { kind: "error", message: cutToBytes(message, DIGEST_LIMITS.excerptBytes) };
  }
  // Running returned above, and only the unrecorded trailing turn is ever queued.
  return { kind: state === "interrupted" ? "interrupted" : "completed" };
}

/** Open steps of the most recent plan update, as `step (status)`. */
function openTodos(activities: OrchestrationThread["activities"]): ReadonlyArray<string> {
  const update = activities.findLast((activity) => activity.kind === "turn.plan.updated");
  const plan = update ? payloadOf(update)?.plan : undefined;
  if (!Array.isArray(plan)) return [];
  return plan.flatMap((entry: unknown) => {
    if (!Predicate.isObject(entry)) return [];
    const step = stringOrUndefined(entry.step);
    const status = stringOrUndefined(entry.status);
    if (!step || status === "completed") return [];
    return [cutToBytes(status ? `${step} (${status})` : step, DIGEST_LIMITS.excerptBytes)];
  });
}

function lastActivityAt(thread: OrchestrationThread): string {
  let latest = thread.createdAt;
  for (const message of thread.messages) if (message.updatedAt > latest) latest = message.updatedAt;
  for (const activity of thread.activities) {
    if (activity.createdAt > latest) latest = activity.createdAt;
  }
  return latest;
}

/**
 * Deterministic, bounded summary of a thread for an agent picking up its work. The last
 * `recentTurns` turns are kept in detail and earlier ones are reduced to one-line outcomes.
 */
export function buildThreadDigest(input: {
  readonly thread: OrchestrationThread;
  readonly projectTitle: string | null;
  /** Title of the thread `thread` continues, when that thread exists and the caller may read it. */
  readonly continuedFromTitle: string | null;
  readonly callerWorktreePath: string | null;
  readonly recentTurns: number;
}): ThreadDigest {
  const { thread } = input;
  const turns = reconstructTurns(thread);

  const userTexts = turns.flatMap((turn) =>
    turn.userMessages.map((message) => ({ turn: turn.n, text: message.text })),
  );
  const [first, ...later] = userTexts;

  const detailStart = recentStart(turns.length, input.recentTurns);

  return {
    header: {
      threadId: thread.id,
      title: thread.title,
      projectTitle: input.projectTitle,
      provider: thread.session?.providerName ?? null,
      model: thread.modelSelection.model,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      worktreeRelation:
        thread.worktreePath === null
          ? "none"
          : thread.worktreePath === input.callerWorktreePath
            ? "shared"
            : "different",
      createdAt: thread.createdAt,
      lastActivityAt: lastActivityAt(thread),
      status: deriveStatus(thread, turns),
      continuedFrom: thread.continuedFromThreadId
        ? { threadId: thread.continuedFromThreadId, title: input.continuedFromTitle }
        : null,
    },
    goal: first ? cutToBytes(first.text, DIGEST_LIMITS.goalBytes) : null,
    steering: later.map((entry) => ({
      turn: entry.turn,
      text: cutToBytes(entry.text, DIGEST_LIMITS.steeringBytes),
    })),
    openWork: {
      todos: openTodos(thread.activities),
      plans: thread.proposedPlans
        .filter((plan) => plan.implementedAt === null)
        .map((plan) => ({
          id: plan.id,
          excerpt: cutToBytes(plan.planMarkdown, DIGEST_LIMITS.excerptBytes),
        })),
      comments: (thread.documentComments ?? [])
        .filter((comment) => comment.status === "open")
        .map((comment) => ({
          file: comment.filePath,
          text: cutToBytes(comment.body, DIGEST_LIMITS.excerptBytes),
        })),
      pullRequests: thread.pullRequests
        .filter((link) => link.source !== "stack-dismissed")
        .map((link) => ({
          number: link.number,
          state: link.snapshot?.state ?? "unknown",
          url: link.url,
        })),
    },
    earlierTurns: turns.slice(0, detailStart).map(toTurnSummary),
    recentTurns: turns.slice(detailStart).map(toTurnDetail),
  };
}
