import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";

const runId = RunId.make("thinking-run");
const at = "2026-10-05T10:00:00Z";

function work(id: string, entry: Omit<WorkLogEntry, "id" | "createdAt" | "runId">): TimelineEntry {
  return { kind: "work", id, createdAt: at, entry: { id, createdAt: at, runId, ...entry } };
}

const thought = (id: string, status: WorkLogEntry["toolLifecycleStatus"] = "completed") =>
  work(id, {
    label: "Thinking",
    tone: "thinking",
    itemType: "reasoning",
    detail: `${id} text`,
    toolLifecycleStatus: status,
  });

const command = (id: string, status: WorkLogEntry["toolLifecycleStatus"] = "completed") =>
  work(id, {
    label: "Ran command",
    tone: "tool",
    itemType: "command_execution",
    command: `cat ${id}`,
    toolLifecycleStatus: status,
  });

const question = work("question", {
  label: "Input requested",
  tone: "tool",
  itemType: "user_input_request",
  toolLifecycleStatus: "inProgress",
});

const answer: TimelineEntry = {
  kind: "message",
  id: "answer",
  createdAt: at,
  message: {
    id: MessageId.make("answer"),
    role: "assistant",
    text: "Done",
    runId,
    streaming: false,
    createdAt: at,
    updatedAt: at,
  },
};

function groupedIds(row: MessagesTimelineRow): string[] {
  return row.kind === "work" || row.kind === "work-live"
    ? row.groupedEntries.map((entry) => entry.id)
    : [];
}

function mixesThinkingAndTools(row: MessagesTimelineRow): boolean {
  if (row.kind !== "work" && row.kind !== "work-live") return false;
  const thoughts = row.groupedEntries.filter((entry) => entry.itemType === "reasoning");
  return thoughts.length > 0 && thoughts.length < row.groupedEntries.length;
}

describe("thinking stays apart from tool calls", () => {
  it("gives each thought its own row between tool groups in a settled run", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        command("a"),
        thought("t1"),
        thought("t2"),
        command("b"),
        command("c"),
        answer,
      ],
      expandedRunIds: new Set([runId]),
      expandedWorkGroupIds: new Set(["work-group:b"]),
      isWorking: false,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(rows.some(mixesThinkingAndTools)).toBe(false);
    const work = rows.filter((row) => row.kind === "work" && !row.isExpandedToolGroup);
    expect(work.map(groupedIds)).toEqual([["a"], ["t1"], ["t2"]]);
    expect(rows.find((row) => row.kind === "work-toggle")).toMatchObject({
      groupId: "work-group:b",
      hiddenCount: 2,
    });
  });

  it("keeps the thoughts that lead into a pending question visible and drops the shimmer", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        command("a"),
        thought("t1"),
        thought("t2"),
        command("ask", "inProgress"),
        question,
      ],
      runningRunId: runId,
      isWorking: true,
      activeTurnStartedAt: at,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(rows.some(mixesThinkingAndTools)).toBe(false);
    expect(rows.some((row) => row.kind === "thinking")).toBe(false);
    expect(rows.filter((row) => row.kind === "work").map(groupedIds)).toEqual([
      ["a"],
      ["t1"],
      ["t2"],
    ]);
    expect(rows.find((row) => row.kind === "work-live")).toMatchObject({
      active: true,
      entry: { id: "question" },
      groupedEntries: [{ id: "ask" }, { id: "question" }],
    });
  });

  it("streams only the current thought in the live row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [command("a"), thought("t1", "inProgress")],
      runningRunId: runId,
      isWorking: true,
      activeTurnStartedAt: at,
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
    expect(rows.some(mixesThinkingAndTools)).toBe(false);
    expect(rows.find((row) => row.kind === "work-live")).toMatchObject({
      active: true,
      entry: { id: "t1" },
      groupedEntries: [{ id: "t1" }],
    });
  });
});
