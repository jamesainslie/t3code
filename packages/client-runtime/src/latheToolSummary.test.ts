import { describe, expect, it } from "vite-plus/test";

import { summarizeLatheToolCalls, type LatheToolSummaryCall } from "./latheToolSummary.ts";

function completed(input: unknown, output?: unknown): LatheToolSummaryCall {
  return { input, output, outcome: "completed" };
}

describe("summarizeLatheToolCalls", () => {
  it("counts roadmap reads by call and roadmap changes by work item", () => {
    expect(summarizeLatheToolCalls("roadmap-read", [completed({}), completed({})]).label).toBe(
      "Read the roadmap 2 times",
    );
    expect(
      summarizeLatheToolCalls("roadmap-create", [
        completed({}, { itemId: "item-1", sequence: 1 }),
        completed({}, { itemId: "item-2", sequence: 2 }),
      ]).label,
    ).toBe("Created 2 work items");
    expect(
      summarizeLatheToolCalls("roadmap-update", [
        completed({ criterionId: "c1" }, { itemId: "item-1", sequence: 3 }),
        completed({ state: "done" }, { itemId: "item-1", sequence: 4 }),
      ]).label,
    ).toBe("Updated 1 work item");
  });

  it("sums logged hours once per entry and counts the work items", () => {
    const retried = { itemId: "item-1", sequence: 5, entryId: "entry-1", totalHours: 1.5 };
    expect(
      summarizeLatheToolCalls("roadmap-log-hours", [
        completed({ hours: 1.5, clientRequestId: "log-1" }, retried),
        completed({ hours: 1.5, clientRequestId: "log-1" }, retried),
        completed({ hours: 2 }, { itemId: "item-1", sequence: 6, entryId: "entry-2" }),
        completed(
          { itemId: "item-2", hours: 0.5 },
          { itemId: "item-2", sequence: 7, entryId: "entry-3" },
        ),
      ]).label,
    ).toBe("Logged 4 hours on 2 work items");
    expect(
      summarizeLatheToolCalls("roadmap-log-hours", [
        { input: { hours: 1 }, output: undefined, outcome: "failed" },
      ]),
    ).toEqual({ label: "Tried to log 1 hour on 1 work item", failedCount: 1 });
  });

  it("reads provider result envelopes without treating JSON in the message as result data", () => {
    const result = { messageId: "message-1", threadId: "actual-thread" };
    const json = JSON.stringify(result);
    const outputs = [
      result,
      { structuredContent: result },
      [{ type: "text", text: json }],
      { content: [{ text: { text: json } }], isError: false },
      json,
    ];
    const calls = outputs.map((output) =>
      completed(
        {
          toolName: "lathe_thread_send",
          args: { threadId: "input-thread", message: '{"threadId":"fake"}' },
        },
        output,
      ),
    );
    expect(summarizeLatheToolCalls("thread-send", calls).label).toBe("Sent 1 message to 1 thread");
    expect(
      summarizeLatheToolCalls("thread-send", [
        completed({ toolName: "lathe_thread_send", args: { threadId: "input-thread" } }),
        completed({ threadId: "input-thread" }),
      ]).label,
    ).toBe("Sent 2 messages to 1 thread");
  });

  it("excludes failed and unfinished sends even if the provider reports completed", () => {
    const calls: LatheToolSummaryCall[] = [
      completed({ threadId: "success" }, { messageId: "ok", threadId: "success" }),
      completed(
        { threadId: "failed" },
        { isError: true, structuredContent: { threadId: "failed" } },
      ),
      completed({ threadId: "failed" }, [
        { type: "text", text: JSON.stringify({ _tag: "OrchestratorMcpFailure" }) },
      ]),
      { input: { threadId: "cancelled" }, output: undefined, outcome: "unfinished" },
    ];
    expect(summarizeLatheToolCalls("thread-send", calls)).toEqual({
      label: "Sent 1 message to 1 thread",
      failedCount: 2,
    });
    expect(summarizeLatheToolCalls("thread-send", [calls[1]!])).toEqual({
      label: "Tried to send 1 message to 1 thread",
      failedCount: 1,
    });
  });

  it("does not confuse a child's failure or wait timeout with failure of the orchestration call", () => {
    const failedChild = { taskId: "task-1", status: "failed", summary: "command not found" };
    expect(
      summarizeLatheToolCalls("delegate", [completed({}, failedChild), completed({}, failedChild)]),
    ).toEqual({
      label: "Delegated 1 task",
      failedCount: 0,
    });
    expect(
      summarizeLatheToolCalls(
        "task-status",
        Array.from({ length: 4 }, () => completed({ taskId: "task-1" }, failedChild)),
      ).label,
    ).toBe("Checked task status 4 times");
    expect(
      summarizeLatheToolCalls("thread-wait", [
        completed({ threadId: "thread-1" }, { threadId: "thread-1", timedOut: true }),
      ]),
    ).toEqual({
      label: "Waited on 1 thread",
      failedCount: 0,
    });
  });
});
