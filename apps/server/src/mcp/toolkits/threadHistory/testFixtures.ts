import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointFile,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";

// Read-model builders shared by the thread history tests. `t` is seconds after a fixed epoch,
// so fixtures read in message order.

export const THREAD_ID = ThreadId.make("thread-history-1");
const PROJECT_ID = ProjectId.make("project-history-1");

const pad = (value: number) => String(value).padStart(2, "0");

// Valid for whole seconds 0 <= t < 86_400 (one day); larger values produce an invalid hour.
export const at = (t: number) =>
  `2026-09-01T${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}.000Z`;

export const turn = (id: string) => TurnId.make(id);

function message(
  id: string,
  role: OrchestrationMessage["role"],
  t: number,
  text: string,
  turnId: TurnId | null,
): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text,
    turnId,
    streaming: false,
    createdAt: at(t),
    updatedAt: at(t),
  };
}

export const userMessage = (id: string, t: number, text = `user ${id}`) =>
  message(id, "user", t, text, null);

export const assistantMessage = (id: string, t: number, turnId: TurnId, text = `reply ${id}`) =>
  message(id, "assistant", t, text, turnId);

export const reasoningMessage = (id: string, t: number, turnId: TurnId, text = `thinking ${id}`) =>
  message(id, "reasoning", t, text, turnId);

export function activity(input: {
  readonly id: string;
  readonly t: number;
  readonly kind: string;
  readonly turnId: TurnId | null;
  readonly tone?: OrchestrationThreadActivity["tone"];
  readonly summary?: string;
  readonly payload?: unknown;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(input.id),
    tone: input.tone ?? "info",
    kind: input.kind,
    summary: input.summary ?? input.kind,
    payload: input.payload ?? {},
    turnId: input.turnId,
    createdAt: at(input.t),
  };
}

export function checkpoint(
  turnId: TurnId,
  turnCount: number,
  files: ReadonlyArray<OrchestrationCheckpointFile> = [],
): OrchestrationCheckpointSummary {
  return {
    turnId,
    checkpointTurnCount: turnCount,
    checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${turnCount}`),
    status: "ready",
    files,
    assistantMessageId: null,
    completedAt: at(1_000 + turnCount),
  };
}

export function latestTurn(
  turnId: TurnId,
  state: OrchestrationLatestTurn["state"],
): OrchestrationLatestTurn {
  return {
    turnId,
    state,
    requestedAt: at(0),
    startedAt: at(0),
    completedAt: state === "running" ? null : at(2_000),
    assistantMessageId: null,
  };
}

export function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread history fixture",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}
