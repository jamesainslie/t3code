import {
  MessageId,
  RunId,
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
  threadFeedActivityExpanded,
  type ThreadFeedActivity,
  type ThreadFeedEntry,
} from "./threadActivity";

const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");
const at = "2026-10-05T10:00:01.000Z";
const settledRun = { runId, status: "completed", startedAt: at, completedAt: at } as const;

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

const command = (id: string, ordinal: number, exitCode = 0): OrchestrationV2TurnItem => ({
  ...base(id, ordinal),
  type: "command_execution",
  input: `cat ${id}`,
  output: "ok",
  exitCode,
});

const search: OrchestrationV2TurnItem = {
  ...base("search", 3),
  type: "file_search",
  pattern: "needle",
};

const answer: OrchestrationV2TurnItem = {
  ...base("answer", 9),
  type: "assistant_message",
  messageId: MessageId.make("answer"),
  text: "Done",
  streaming: false,
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

const toggle = (rows: ReadonlyArray<ThreadFeedEntry>) =>
  rows.find((row) => row.type === "work-toggle");
const groupId = "work-group:local:thread-1:a";

function presented(mode: "collapsed" | "exposed", toggled: ReadonlySet<string> = new Set()) {
  return deriveThreadFeedPresentation(
    feed([user, command("a", 1), command("b", 2), answer]),
    settledRun,
    new Set([runId]),
    toggled,
    null,
    false,
    mode,
  );
}

function activity(item: OrchestrationV2TurnItem): ThreadFeedActivity {
  const group = feed([item]).find((entry) => entry.type === "activity-group");
  if (group?.type !== "activity-group") throw new Error("expected an activity group");
  return group.activities[0]!;
}

describe("exposed commands on mobile", () => {
  it("opens a settled group that ran a command only when exposed", () => {
    expect(toggle(presented("collapsed"))).toMatchObject({ groupId, expanded: false });
    expect(toggle(presented("exposed"))).toMatchObject({ groupId, expanded: true });
  });

  it("leaves groups without a command closed", () => {
    const rows = deriveThreadFeedPresentation(
      feed([user, search, { ...search, id: TurnItemId.make("search-2"), ordinal: 4 }, answer]),
      settledRun,
      new Set([runId]),
      new Set(),
      null,
      false,
      "exposed",
    );
    expect(toggle(rows)).toMatchObject({ expanded: false });
  });

  it("treats a toggled group as the opposite of its default", () => {
    const toggled = new Set([groupId]);
    expect(toggle(presented("exposed", toggled))).toMatchObject({ expanded: false });
    expect(toggle(presented("collapsed", toggled))).toMatchObject({ expanded: true });
  });

  it("opens failed commands, and every command when exposed", () => {
    const ok = activity(command("ok", 1));
    const failed = activity(command("bad", 1, 2));
    expect(threadFeedActivityExpanded(ok, {}, "collapsed")).toBe(false);
    expect(threadFeedActivityExpanded(failed, {}, "collapsed")).toBe(true);
    expect(threadFeedActivityExpanded(ok, {}, "exposed")).toBe(true);
    expect(threadFeedActivityExpanded(failed, { [failed.id]: true }, "collapsed")).toBe(false);
  });
});
