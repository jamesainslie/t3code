import * as DateTime from "effect/DateTime";
import type {
  OrchestrationV2CheckpointFileSummary,
  OrchestrationV2ConversationMessage,
  OrchestrationV2Run,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  RunId,
} from "@t3tools/contracts";

export type DigestTurnState = "running" | "completed" | "interrupted" | "error" | "queued";

/** The parts of a v2 thread projection a digest reads. */
export type HistoryThread = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "messages" | "turnItems" | "plans" | "checkpoints" | "providerThreads"
>;

export interface ReconstructedTurn {
  readonly n: number;
  /** Null for a turn imported from a v1 thread, which kept its messages but not its runs. */
  readonly runId: RunId | null;
  readonly state: DigestTurnState;
  readonly userMessages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly assistantMessages: ReadonlyArray<OrchestrationV2ConversationMessage>;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>;
}

/** How a digest reads a run's status. */
export function runState(run: Pick<OrchestrationV2Run, "status">): DigestTurnState {
  switch (run.status) {
    case "queued":
      return "queued";
    case "completed":
      return "completed";
    case "interrupted":
    case "cancelled":
      return "interrupted";
    case "failed":
      return "error";
    case "preparing":
    case "starting":
    case "running":
    case "waiting":
      return "running";
    case "rolled_back":
      return "interrupted";
  }
}

/** Items a digest lists as a turn's errors: the provider failures recorded in it. */
export const isErrorItem = (
  item: OrchestrationV2TurnItem,
): item is Extract<OrchestrationV2TurnItem, { readonly type: "error" }> => item.type === "error";

/**
 * Messages imported from a v1 thread carry no run. Like v1, each user message opens a turn
 * and the assistant replies after it join that turn; they come before any v2 run.
 */
function importedTurns(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): ReadonlyArray<Omit<ReconstructedTurn, "n">> {
  const turns: Array<{
    userMessages: OrchestrationV2ConversationMessage[];
    assistantMessages: OrchestrationV2ConversationMessage[];
  }> = [];
  for (const message of messages) {
    const current = turns.at(-1);
    if (message.role === "user") {
      if (current === undefined || current.assistantMessages.length > 0) {
        turns.push({ userMessages: [message], assistantMessages: [] });
      } else {
        current.userMessages.push(message);
      }
    } else if (message.role === "assistant") {
      if (current === undefined) turns.push({ userMessages: [], assistantMessages: [message] });
      else current.assistantMessages.push(message);
    }
  }
  return turns.map((turn) => ({
    runId: null,
    state: "completed",
    ...turn,
    items: [],
    files: [],
  }));
}

/**
 * A run is one turn. Rolled-back runs were undone, and a queued run cancelled before it
 * started never happened, so neither appears. Steering messages join the run they steered.
 */
export function reconstructTurns(thread: HistoryThread): ReadonlyArray<ReconstructedTurn> {
  const runs = thread.runs
    .filter(
      (run) =>
        run.status !== "rolled_back" && !(run.status === "cancelled" && run.startedAt === null),
    )
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const byCreatedAt = (
    left: OrchestrationV2ConversationMessage,
    right: OrchestrationV2ConversationMessage,
  ) => DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt);
  const messages = thread.messages.toSorted(byCreatedAt);
  const runUserMessageIds = new Set(thread.runs.map((run) => run.userMessageId));
  const imported = importedTurns(
    messages.filter((message) => message.runId === null && !runUserMessageIds.has(message.id)),
  );
  const fromRuns = runs.map((run) => {
    const userMessages = messages.filter(
      (message) =>
        message.role === "user" && (message.id === run.userMessageId || message.runId === run.id),
    );
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant" && message.runId === run.id,
    );
    const files = thread.checkpoints
      .filter((checkpoint) => checkpoint.runId === run.id)
      .flatMap((checkpoint) => checkpoint.files);
    return {
      runId: run.id,
      state: runState(run),
      userMessages,
      assistantMessages,
      items: thread.turnItems.filter((item) => item.runId === run.id),
      files,
    };
  });
  return [...imported, ...fromRuns].map((turn, index) => ({ n: index + 1, ...turn }));
}
