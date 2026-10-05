import {
  MessageId,
  NodeId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadFeed,
  deriveThreadFeedPresentation,
  type ThreadFeedEntry,
} from "./threadActivity";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");
const at = "2026-10-05T10:00:01.000Z";

function base(id: string, ordinal: number) {
  const timestamp = DateTime.makeUnsafe(at);
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

const user: OrchestrationV2TurnItem = {
  ...base("user", 0),
  type: "user_message",
  messageId: MessageId.make("user"),
  createdBy: "user",
  creationSource: "mobile",
  inputIntent: "turn_start",
  text: "Go",
  attachments: [],
};

const command = (id: string, ordinal: number): OrchestrationV2TurnItem => ({
  ...base(id, ordinal),
  type: "command_execution",
  input: `cat ${id}`,
  output: "ok",
  exitCode: 0,
});

const thought = (id: string, ordinal: number): OrchestrationV2TurnItem => ({
  ...base(id, ordinal),
  type: "reasoning",
  text: `${id} text`,
  streaming: false,
});

const answer: OrchestrationV2TurnItem = {
  ...base("answer", 9),
  type: "assistant_message",
  messageId: MessageId.make("answer"),
  text: "Done",
  streaming: false,
};

const askTool = {
  ...base("ask", 5),
  status: "running",
  completedAt: null,
  type: "dynamic_tool",
  toolName: "AskUserQuestion",
  input: {},
} as unknown as OrchestrationV2TurnItem;

const question: OrchestrationV2TurnItem = {
  ...base("question", 6),
  nodeId: NodeId.make("question-node"),
  status: "waiting",
  completedAt: null,
  type: "user_input_request",
  requestId: RuntimeRequestId.make("question"),
  questions: [
    {
      id: "pick",
      header: "Pick",
      question: "Which?",
      required: true,
      allowCustomAnswer: true,
      options: [{ label: "A", value: "a", description: "Option A" }],
    },
  ],
};

function feed(items: ReadonlyArray<OrchestrationV2TurnItem>) {
  return buildThreadFeed(
    items.map((item, position): OrchestrationV2ProjectedTurnItem => ({
      position,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
  );
}

function groupIds(rows: ReadonlyArray<ThreadFeedEntry>): string[] {
  return rows.flatMap((row) => (row.type === "work-toggle" ? [row.groupId] : []));
}

describe("thinking stays apart from tool calls on mobile", () => {
  it("gives each thought its own row between tool groups", () => {
    const items = [
      user,
      command("a", 1),
      thought("t1", 2),
      thought("t2", 3),
      command("b", 4),
      command("c", 5),
      answer,
    ];
    const rows = deriveThreadFeedPresentation(
      feed(items),
      { runId, status: "completed", startedAt: at, completedAt: at },
      new Set([runId]),
    );
    expect(groupIds(rows)).toEqual([
      "work-group:local:thread-1:a",
      "work-group:local:thread-1:t1",
      "work-group:local:thread-1:t2",
      "work-group:local:thread-1:b",
    ]);
  });

  it("keeps the thoughts that lead into a pending question in their own rows", () => {
    const rows = deriveThreadFeedPresentation(
      feed([user, command("a", 1), thought("t1", 2), thought("t2", 3), askTool, question]),
      { runId, status: "running", startedAt: at, completedAt: null },
      new Set(),
      new Set(),
      at,
    );
    expect(groupIds(rows)).toEqual([
      "work-group:local:thread-1:a",
      "work-group:local:thread-1:t1",
      "work-group:local:thread-1:t2",
      "work-group:local:thread-1:ask",
    ]);
    expect(rows.some((row) => row.type === "thinking")).toBe(false);
  });
});
