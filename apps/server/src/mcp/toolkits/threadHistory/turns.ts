import type {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationThread,
  OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";

export type DigestTurnState = "running" | "completed" | "interrupted" | "error" | "queued";

export interface ReconstructedTurn {
  readonly n: number;
  /** Null only for a trailing queued turn the provider has not started. */
  readonly turnId: TurnId | null;
  readonly state: DigestTurnState;
  readonly userMessages: ReadonlyArray<OrchestrationMessage>;
  readonly assistantMessages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly checkpoint: OrchestrationCheckpointSummary | null;
}

interface TurnDraft {
  readonly turnId: TurnId | null;
  readonly userMessages: OrchestrationMessage[];
  readonly assistantMessages: OrchestrationMessage[];
}

/** Activities that fail the turn they belong to. */
export const isTurnFailure = (activity: OrchestrationThreadActivity) =>
  activity.kind === "runtime.error" || activity.kind === "provider.turn.start.failed";

/**
 * Activities a digest lists as a turn's errors. Tool denials and task failures are reported
 * without failing the turn; checkpoint bookkeeping failures are not the agent's work at all.
 */
export const isErrorActivity = (activity: OrchestrationThreadActivity) =>
  !activity.kind.startsWith("checkpoint.") &&
  (isTurnFailure(activity) || activity.tone === "error");

/**
 * Rebuilds turns from message order. User messages carry no turn id, so each one joins the
 * next turn an assistant message opens; turns without a user message (background wake-ups)
 * stand alone. Reasoning and system messages never open or join a turn.
 */
export function reconstructTurns(thread: OrchestrationThread): ReadonlyArray<ReconstructedTurn> {
  const drafts: TurnDraft[] = [];
  const draftsByTurnId = new Map<TurnId, TurnDraft>();
  let pendingUsers: OrchestrationMessage[] = [];

  const openTurn = (turnId: TurnId | null) => {
    const draft: TurnDraft = { turnId, userMessages: pendingUsers, assistantMessages: [] };
    pendingUsers = [];
    drafts.push(draft);
    if (turnId !== null) draftsByTurnId.set(turnId, draft);
    return draft;
  };

  const messages = thread.messages.toSorted((left, right) =>
    left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0,
  );
  for (const message of messages) {
    if (message.role === "user") {
      pendingUsers.push(message);
      continue;
    }
    if (message.role !== "assistant" || message.turnId === null) continue;
    const draft = draftsByTurnId.get(message.turnId) ?? openTurn(message.turnId);
    draft.assistantMessages.push(message);
  }

  const latest = thread.latestTurn;
  let queuedTurn: TurnDraft | null = null;
  if (pendingUsers.length > 0) {
    const startedUnseen = latest !== null && !draftsByTurnId.has(latest.turnId);
    const trailing = openTurn(startedUnseen ? latest.turnId : null);
    if (!startedUnseen) queuedTurn = trailing;
  }
  // A turn that failed or was stopped before replying has no messages; keep it for its errors.
  if (
    latest !== null &&
    !draftsByTurnId.has(latest.turnId) &&
    (latest.state === "error" || latest.state === "interrupted")
  ) {
    openTurn(latest.turnId);
  }

  const activitiesByTurnId = new Map<TurnId, OrchestrationThreadActivity[]>();
  for (const activity of thread.activities) {
    if (activity.turnId === null || !draftsByTurnId.has(activity.turnId)) continue;
    const list = activitiesByTurnId.get(activity.turnId) ?? [];
    list.push(activity);
    activitiesByTurnId.set(activity.turnId, list);
  }
  const checkpointsByTurnId = new Map(
    thread.checkpoints.map((checkpoint) => [checkpoint.turnId, checkpoint] as const),
  );

  return drafts.map((draft, index) => {
    const activities = draft.turnId === null ? [] : (activitiesByTurnId.get(draft.turnId) ?? []);
    const state: DigestTurnState =
      draft === queuedTurn
        ? "queued"
        : latest !== null && draft.turnId === latest.turnId
          ? latest.state
          : activities.some(isTurnFailure)
            ? "error"
            : "completed";
    return {
      n: index + 1,
      turnId: draft.turnId,
      state,
      userMessages: draft.userMessages,
      assistantMessages: draft.assistantMessages,
      activities,
      checkpoint: draft.turnId === null ? null : (checkpointsByTurnId.get(draft.turnId) ?? null),
    };
  });
}
