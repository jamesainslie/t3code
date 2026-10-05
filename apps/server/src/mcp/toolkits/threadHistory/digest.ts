import type {
  OrchestrationV2CheckpointFileSummary,
  OrchestrationV2TurnItem,
  ThreadDocumentComment,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { cutToBytes } from "./text.ts";
import {
  isErrorItem,
  reconstructTurns,
  type DigestTurnState,
  type HistoryThread,
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
  readonly files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>;
  readonly errors: ReadonlyArray<string>;
}

export interface DigestTurnSummary {
  readonly n: number;
  readonly state: DigestTurnState;
  readonly outcome: string;
  readonly files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>;
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

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

/** One line per tool call: what ran, how it ended, and the detail that names it. */
function toolLine(item: OrchestrationV2TurnItem): string | null {
  const detail = (() => {
    switch (item.type) {
      case "command_execution":
        return item.exitCode === undefined ? item.input : `${item.input} (exit ${item.exitCode})`;
      case "file_change":
        return `${item.fileName} +${item.additions ?? 0} -${item.deletions ?? 0}`;
      case "file_search":
        return item.pattern ?? null;
      case "web_search":
        return item.patterns?.join(", ") ?? null;
      case "dynamic_tool":
        return null;
      default:
        return undefined;
    }
  })();
  if (detail === undefined) return null;
  const name =
    item.type === "dynamic_tool"
      ? (item.toolName ?? item.title ?? "tool")
      : (item.title ?? item.type);
  const head = `${name} ${item.status}`;
  return cutToBytes(detail ? `${head}: ${detail}` : head, DIGEST_LIMITS.toolDetailBytes);
}

const errorText = (item: Extract<OrchestrationV2TurnItem, { readonly type: "error" }>) =>
  item.failure.message;

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
    tools: turn.items.flatMap((item) => toolLine(item) ?? []),
    files: turn.files,
    errors: turn.items
      .filter(isErrorItem)
      .map((item) => cutToBytes(errorText(item), DIGEST_LIMITS.excerptBytes)),
  };
}

/** The outcome is the turn's last assistant message, or its last error when it never replied. */
function toTurnSummary(turn: ReconstructedTurn): DigestTurnSummary {
  const lastError = turn.items.findLast(isErrorItem);
  const outcome =
    nonEmptyTexts(turn.assistantMessages).at(-1) ??
    (lastError ? errorText(lastError) : undefined) ??
    "";
  return {
    n: turn.n,
    state: turn.state,
    outcome: cutToBytes(outcome, DIGEST_LIMITS.earlierTurnBytes),
    files: turn.files,
  };
}

/** The active provider thread's last context reading. */
function contextUsage(thread: HistoryThread) {
  const usage = thread.providerThreads.find(
    (providerThread) => providerThread.id === thread.thread.activeProviderThreadId,
  )?.contextUsage;
  if (!usage?.maxTokens || usage.usedTokens < 0) return undefined;
  return { usedTokens: usage.usedTokens, maxTokens: usage.maxTokens };
}

function deriveStatus(
  thread: HistoryThread,
  turns: ReadonlyArray<ReconstructedTurn>,
): ThreadDigestStatus {
  const current = turns.findLast((turn) => turn.state !== "queued");
  if (current?.state === "running") return { kind: "running" };
  if (turns.length === 0) return { kind: "empty" };
  const usage = contextUsage(thread);
  if (usage && usage.usedTokens / usage.maxTokens >= DIGEST_LIMITS.contextFullRatio) {
    return { kind: "context-full", ...usage };
  }
  if (current?.state === "error") {
    const lastError = current.items.findLast(isErrorItem);
    const message = (lastError ? errorText(lastError) : undefined) ?? "Turn failed";
    return { kind: "error", message: cutToBytes(message, DIGEST_LIMITS.excerptBytes) };
  }
  return { kind: current?.state === "interrupted" ? "interrupted" : "completed" };
}

/** Open steps of the most recent todo list, as `step (status)`. */
function openTodos(thread: HistoryThread): ReadonlyArray<string> {
  const list = thread.plans.findLast(
    (plan) => plan.kind === "todo_list" && plan.status !== "superseded",
  );
  if (list === undefined || list.kind !== "todo_list") return [];
  return list.steps.flatMap((step) =>
    step.status === "completed"
      ? []
      : [cutToBytes(`${step.text} (${step.status})`, DIGEST_LIMITS.excerptBytes)],
  );
}

function lastActivityAt(thread: HistoryThread): string {
  let latest = thread.thread.createdAt;
  for (const message of thread.messages) {
    if (DateTime.toEpochMillis(message.updatedAt) > DateTime.toEpochMillis(latest)) {
      latest = message.updatedAt;
    }
  }
  for (const item of thread.turnItems) {
    if (DateTime.toEpochMillis(item.updatedAt) > DateTime.toEpochMillis(latest)) {
      latest = item.updatedAt;
    }
  }
  return iso(latest);
}

/**
 * Deterministic, bounded summary of a thread for an agent picking up its work. The last
 * `recentTurns` turns are kept in detail and earlier ones are reduced to one-line outcomes.
 */
export function buildThreadDigest(input: {
  readonly thread: HistoryThread;
  readonly comments: ReadonlyArray<ThreadDocumentComment>;
  readonly projectTitle: string | null;
  /** Title of the thread `thread` continues, when that thread exists and the caller may read it. */
  readonly continuedFromTitle: string | null;
  readonly callerWorktreePath: string | null;
  readonly recentTurns: number;
}): ThreadDigest {
  const { thread } = input;
  const app = thread.thread;
  const turns = reconstructTurns(thread);

  const userTexts = turns.flatMap((turn) =>
    turn.userMessages.map((message) => ({ turn: turn.n, text: message.text })),
  );
  const [first, ...later] = userTexts;

  const detailStart = recentStart(turns.length, input.recentTurns);

  return {
    header: {
      threadId: app.id,
      title: app.title,
      projectTitle: input.projectTitle,
      provider: app.providerInstanceId,
      model: app.modelSelection.model,
      branch: app.branch,
      worktreePath: app.worktreePath,
      worktreeRelation:
        app.worktreePath === null
          ? "none"
          : app.worktreePath === input.callerWorktreePath
            ? "shared"
            : "different",
      createdAt: iso(app.createdAt),
      lastActivityAt: lastActivityAt(thread),
      status: deriveStatus(thread, turns),
      continuedFrom: app.continuedFromThreadId
        ? { threadId: app.continuedFromThreadId, title: input.continuedFromTitle }
        : null,
    },
    goal: first ? cutToBytes(first.text, DIGEST_LIMITS.goalBytes) : null,
    steering: later.map((entry) => ({
      turn: entry.turn,
      text: cutToBytes(entry.text, DIGEST_LIMITS.steeringBytes),
    })),
    openWork: {
      todos: openTodos(thread),
      plans: thread.plans
        .filter(
          (plan) =>
            plan.kind === "proposed_plan" && (plan.status === "draft" || plan.status === "active"),
        )
        .map((plan) => ({
          id: plan.id,
          excerpt: cutToBytes(
            plan.kind === "proposed_plan" ? plan.markdown : "",
            DIGEST_LIMITS.excerptBytes,
          ),
        })),
      comments: input.comments
        .filter((comment) => comment.status === "open")
        .map((comment) => ({
          file: comment.filePath,
          text: cutToBytes(comment.body, DIGEST_LIMITS.excerptBytes),
        })),
      pullRequests: (app.pullRequests ?? [])
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
