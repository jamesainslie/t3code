/**
 * Fork: background generation usage. Removing a generation's session cascades
 * to its `session_message` rows, so the usage scan never sees the call. The
 * steps' token counts on the event stream become its only record.
 */
import type { UsageTokenTotals } from "@lathe/contracts";
import { reportTextGenerationUsage } from "@lathe/provider-core/server/textGenerationUsageFork";
import { tokenCount, totalTokens } from "@lathe/provider-core/server/usage";
import * as Effect from "effect/Effect";

interface StepUsage {
  readonly cost?: number | undefined;
  readonly tokens?:
    | {
        readonly input: number;
        readonly output: number;
        readonly reasoning: number;
        readonly cache: { readonly read: number; readonly write: number };
      }
    | undefined;
}

export function makeGenerationUsage() {
  const totals = {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  } satisfies UsageTokenTotals;
  let costUsd = 0;
  return {
    /** For `session.step.ended` and `session.step.failed`, as the adapter counts a turn. */
    addStep: (step: StepUsage) => {
      const tokens = step.tokens;
      if (tokens === undefined) return;
      // As the usage scan reads a stored message: OpenCode's `input` excludes
      // the cache, and its `output` excludes reasoning.
      const reasoning = tokenCount(tokens.reasoning);
      totals.uncachedInputTokens += tokenCount(tokens.input);
      totals.cachedInputTokens += tokenCount(tokens.cache.read);
      totals.cacheCreationTokens += tokenCount(tokens.cache.write);
      totals.outputTokens += tokenCount(tokens.output) + reasoning;
      totals.reasoningTokens += reasoning;
      if (typeof step.cost === "number" && Number.isFinite(step.cost) && step.cost > 0) {
        costUsd += step.cost;
      }
    },
    report: (input: { readonly sessionId: string; readonly model: string }) =>
      totalTokens(totals) === 0
        ? Effect.void
        : reportTextGenerationUsage({
            provider: "opencode",
            sessionId: input.sessionId,
            model: input.model,
            usage: {
              totals: { ...totals },
              // OpenCode writes zero for models without a known rate, so the
              // shared price table estimates those, as for scanned records.
              reportedCostUsd: costUsd > 0 ? costUsd : null,
              speed: "standard",
            },
          }),
  };
}
