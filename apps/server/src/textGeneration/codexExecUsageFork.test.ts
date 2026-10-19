import { describe, expect, it } from "@effect/vitest";

import { codexExecUsage } from "./codexExecUsageFork.ts";

const events = (...lines: readonly unknown[]) =>
  lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");

describe("codexExecUsage", () => {
  it("reads the thread and its turn usage, taking cached input out of input", () => {
    const usage = codexExecUsage(
      events(
        { type: "thread.started", thread_id: "thread-1" },
        { type: "turn.started" },
        { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "{}" } },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 1200,
            cached_input_tokens: 1000,
            output_tokens: 80,
            reasoning_output_tokens: 30,
          },
        },
      ),
    );

    expect(usage).toEqual({
      threadId: "thread-1",
      totals: {
        uncachedInputTokens: 200,
        cachedInputTokens: 1000,
        cacheCreationTokens: 0,
        outputTokens: 80,
        reasoningTokens: 30,
      },
    });
  });

  it("sums every turn and skips lines that are not events", () => {
    const usage = codexExecUsage(
      events(
        "Reading prompt from stdin...",
        { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 1 } },
        "{not json",
        { type: "turn.completed", usage: { input_tokens: 5, output_tokens: 2 } },
      ),
    );

    expect(usage.threadId).toBeNull();
    expect(usage.totals).toMatchObject({ uncachedInputTokens: 15, outputTokens: 3 });
  });

  it("reports no usage for a run that never completed a turn", () => {
    expect(
      codexExecUsage(events({ type: "thread.started", thread_id: "t" }, { type: "turn.failed" })),
    ).toEqual({ threadId: "t", totals: null });
  });
});
