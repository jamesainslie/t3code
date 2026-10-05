import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  NodeId,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2CheckpointFileSummary,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type { HistoryThread } from "./turns.ts";

// V2 projection builders shared by the thread history tests. `t` is seconds after a fixed
// epoch, so fixtures read in message order.

export const THREAD_ID = ThreadId.make("thread-history-1");
const PROJECT_ID = ProjectId.make("project-history-1");
const INSTANCE_ID = ProviderInstanceId.make("codex");

const pad = (value: number) => String(value).padStart(2, "0");

/** ISO time `t` seconds into the fixture day; valid for whole seconds 0 <= t < 86_400. */
export const atIso = (t: number) =>
  `2026-09-01T${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}.000Z`;

export const at = (t: number) => DateTime.makeUnsafe(atIso(t));

export const runId = (id: string) => RunId.make(id);

function message(
  id: string,
  role: OrchestrationV2ConversationMessage["role"],
  t: number,
  text: string,
  run: RunId | null,
): OrchestrationV2ConversationMessage {
  return {
    createdBy: role === "user" ? "user" : "agent",
    creationSource: "web",
    id: MessageId.make(id),
    threadId: THREAD_ID,
    runId: run,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: false,
    createdAt: at(t),
    updatedAt: at(t),
  };
}

/** A user message; `run` is set for messages that steered a run, null for a run's prompt. */
export const userMessage = (id: string, t: number, text = `user ${id}`, run: RunId | null = null) =>
  message(id, "user", t, text, run);

export const assistantMessage = (id: string, t: number, run: RunId, text = `reply ${id}`) =>
  message(id, "assistant", t, text, run);

export function run(input: {
  readonly id: RunId;
  readonly ordinal: number;
  readonly userMessageId: string;
  readonly status?: OrchestrationV2Run["status"];
  readonly t?: number;
}): OrchestrationV2Run {
  const t = input.t ?? input.ordinal * 100;
  const status = input.status ?? "completed";
  return {
    id: input.id,
    threadId: THREAD_ID,
    ordinal: input.ordinal,
    providerInstanceId: INSTANCE_ID,
    modelSelection: { instanceId: INSTANCE_ID, model: "gpt-5" },
    providerThreadId: null,
    userMessageId: MessageId.make(input.userMessageId),
    rootNodeId: null,
    activeAttemptId: null,
    status,
    requestedAt: at(t),
    startedAt: status === "queued" ? null : at(t),
    completedAt: ["completed", "failed", "interrupted", "cancelled"].includes(status)
      ? at(t + 50)
      : null,
    checkpointId: null,
    contextHandoffId: null,
  };
}

const itemBase = (
  id: string,
  t: number,
  run: RunId,
  status: OrchestrationV2TurnItem["status"],
) => ({
  id: TurnItemId.make(id),
  threadId: THREAD_ID,
  runId: run,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: t,
  status,
  title: null,
  startedAt: at(t),
  completedAt: at(t),
  updatedAt: at(t),
});

export const commandItem = (
  id: string,
  t: number,
  run: RunId,
  input: string,
  options: { readonly status?: OrchestrationV2TurnItem["status"]; readonly title?: string } = {},
): OrchestrationV2TurnItem => ({
  ...itemBase(id, t, run, options.status ?? "completed"),
  title: options.title ?? "Bash",
  type: "command_execution",
  input,
});

export const errorItem = (
  id: string,
  t: number,
  run: RunId,
  messageText: string,
): OrchestrationV2TurnItem => ({
  ...itemBase(id, t, run, "failed"),
  type: "error",
  failure: { class: "provider_error", message: messageText, code: null, retryable: null },
});

export const file = (
  path: string,
  additions = 3,
  deletions = 1,
): OrchestrationV2CheckpointFileSummary => ({ path, kind: "modified", additions, deletions });

export const checkpoint = (
  run: RunId,
  ordinal: number,
  files: ReadonlyArray<OrchestrationV2CheckpointFileSummary>,
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${run}`),
  threadId: THREAD_ID,
  scopeId: CheckpointScopeId.make(`scope-${run}`),
  runId: run,
  nodeId: NodeId.make(`node-${run}`),
  parentCheckpointId: null,
  ordinalWithinScope: 0,
  appRunOrdinal: ordinal,
  ref: CheckpointRef.make(`refs/t3/checkpoints/${ordinal}`),
  status: "ready",
  files,
  capturedAt: at(1_000 + ordinal),
});

export const todoList = (
  id: string,
  run: RunId,
  steps: ReadonlyArray<{
    readonly text: string;
    readonly status: "pending" | "running" | "completed";
  }>,
  status: OrchestrationV2PlanArtifact["status"] = "active",
): OrchestrationV2PlanArtifact => ({
  id: PlanId.make(id),
  threadId: THREAD_ID,
  runId: run,
  nodeId: NodeId.make(`node-${id}`),
  status,
  kind: "todo_list",
  steps: steps.map((step, index) => ({ id: `step-${index}`, ...step })),
});

export const proposedPlan = (
  id: string,
  run: RunId,
  markdown: string,
  status: OrchestrationV2PlanArtifact["status"] = "active",
): OrchestrationV2PlanArtifact => ({
  id: PlanId.make(id),
  threadId: THREAD_ID,
  runId: run,
  nodeId: NodeId.make(`node-${id}`),
  status,
  kind: "proposed_plan",
  markdown,
});

function makeAppThread(
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread {
  return {
    createdBy: "user",
    creationSource: "web",
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread history fixture",
    providerInstanceId: INSTANCE_ID,
    modelSelection: { instanceId: INSTANCE_ID, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: THREAD_ID },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function makeThread(
  overrides: Partial<Omit<HistoryThread, "thread">> & {
    readonly thread?: Partial<OrchestrationV2AppThread>;
  } = {},
): HistoryThread {
  const { thread, ...records } = overrides;
  return {
    thread: makeAppThread(thread),
    runs: [],
    messages: [],
    turnItems: [],
    plans: [],
    checkpoints: [],
    providerThreads: [],
    ...records,
  };
}
