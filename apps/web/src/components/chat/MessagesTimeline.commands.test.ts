import { MessageId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry, WorkLogEntry } from "../../session-logic";
import { deriveMessagesTimelineRows, type MessagesTimelineRow } from "./MessagesTimeline.logic";

const runId = RunId.make("command-run");
const at = "2026-10-05T10:00:00Z";

function work(id: string, entry: Omit<WorkLogEntry, "id" | "createdAt" | "runId">): TimelineEntry {
  return { kind: "work", id, createdAt: at, entry: { id, createdAt: at, runId, ...entry } };
}

const command = (id: string) =>
  work(id, {
    label: "Ran command",
    tone: "tool",
    itemType: "command_execution",
    command: `cat ${id}`,
    toolLifecycleStatus: "completed",
  });

const read = (id: string) =>
  work(id, {
    label: "Read file",
    tone: "tool",
    itemType: "dynamic_tool",
    toolLifecycleStatus: "completed",
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

function rowsFor(input: {
  entries: TimelineEntry[];
  exposeCommandGroups: boolean;
  toggled?: ReadonlySet<string>;
}): MessagesTimelineRow[] {
  return deriveMessagesTimelineRows({
    timelineEntries: [...input.entries, answer],
    expandedRunIds: new Set([runId]),
    expandedWorkGroupIds: input.toggled ?? new Set(),
    exposeCommandGroups: input.exposeCommandGroups,
    isWorking: false,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  });
}

const toggle = (rows: MessagesTimelineRow[]) => rows.find((row) => row.kind === "work-toggle");
const hasExpandedGroup = (rows: MessagesTimelineRow[]) =>
  rows.some((row) => row.kind === "work" && row.isExpandedToolGroup);

describe("exposed commands open their tool group", () => {
  it("keeps groups closed when commands are collapsed", () => {
    const rows = rowsFor({ entries: [command("a"), command("b")], exposeCommandGroups: false });
    expect(toggle(rows)).toMatchObject({ expanded: false });
    expect(hasExpandedGroup(rows)).toBe(false);
  });

  it("opens a settled group that ran a command", () => {
    const rows = rowsFor({ entries: [read("r"), command("a")], exposeCommandGroups: true });
    expect(toggle(rows)).toMatchObject({ groupId: "work-group:r", expanded: true });
    expect(hasExpandedGroup(rows)).toBe(true);
  });

  it("leaves groups without a command closed", () => {
    const rows = rowsFor({ entries: [read("r"), read("s")], exposeCommandGroups: true });
    expect(toggle(rows)).toMatchObject({ expanded: false });
  });

  it("lets the user close an exposed group and reopen a collapsed one", () => {
    const toggled = new Set(["work-group:a"]);
    const exposed = rowsFor({
      entries: [command("a"), command("b")],
      exposeCommandGroups: true,
      toggled,
    });
    expect(toggle(exposed)).toMatchObject({ expanded: false });
    expect(hasExpandedGroup(exposed)).toBe(false);
    const collapsed = rowsFor({
      entries: [command("a"), command("b")],
      exposeCommandGroups: false,
      toggled,
    });
    expect(toggle(collapsed)).toMatchObject({ expanded: true });
  });
});
