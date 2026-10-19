/**
 * Fork: background generation usage. `codex exec --ephemeral` writes no
 * rollout, so the usage scan never sees the call. With `--json` its stdout is
 * one event per line, and `turn.completed` carries the turn's usage.
 */
import type { UsageTokenTotals } from "@lathe/contracts";
import { totalsFromInclusiveInput } from "@lathe/provider-core/server/textGenerationUsageFork";
import { tokenCount, totalTokens } from "@lathe/provider-core/server/usage";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

export function codexExecUsage(stdout: string): {
  readonly threadId: string | null;
  readonly totals: UsageTokenTotals | null;
} {
  let threadId: string | null = null;
  const sum = {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    const event = asRecord(Option.getOrUndefined(decodeLine(line)));
    if (event === undefined) continue;
    if (event["type"] === "thread.started" && typeof event["thread_id"] === "string") {
      threadId = event["thread_id"];
    }
    const usage = event["type"] === "turn.completed" ? asRecord(event["usage"]) : undefined;
    if (usage === undefined) continue;
    const output = tokenCount(usage["output_tokens"]);
    const totals = totalsFromInclusiveInput({
      // Codex reports `input_tokens` inclusive of the cached portion.
      input: usage["input_tokens"],
      cacheRead: usage["cached_input_tokens"],
      output,
      reasoning: Math.min(output, tokenCount(usage["reasoning_output_tokens"])),
    });
    sum.uncachedInputTokens += totals.uncachedInputTokens;
    sum.cachedInputTokens += totals.cachedInputTokens;
    sum.cacheCreationTokens += totals.cacheCreationTokens;
    sum.outputTokens += totals.outputTokens;
    sum.reasoningTokens += totals.reasoningTokens;
  }
  return { threadId, totals: totalTokens(sum) === 0 ? null : sum };
}
