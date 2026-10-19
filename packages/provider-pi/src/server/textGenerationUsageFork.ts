/**
 * Fork: background generation usage. `--no-session` writes no transcript, so
 * the usage scan never sees the call. Each assistant `message_end` event
 * carries the usage block a transcript entry would, read here the way the
 * transcript reader in `usage.ts` reads it so the two price alike.
 */
import type { TextGenerationUsageReport } from "@lathe/provider-core/server/textGenerationUsageFork";
import { tokenCount, totalTokens } from "@lathe/provider-core/server/usage";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const AssistantMessage = Schema.Struct({
  role: Schema.Literal("assistant"),
  provider: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  responseModel: Schema.optional(Schema.NonEmptyString),
  usage: Schema.Struct({
    input: Schema.optional(Schema.Unknown),
    output: Schema.optional(Schema.Unknown),
    cacheRead: Schema.optional(Schema.Unknown),
    cacheWrite: Schema.optional(Schema.Unknown),
    reasoning: Schema.optional(Schema.Unknown),
    cost: Schema.optional(Schema.Struct({ total: Schema.Unknown })),
  }),
});
const decodeAssistantMessage = Schema.decodeUnknownOption(AssistantMessage);

export function piGenerationUsage(messages: ReadonlyArray<unknown>): {
  readonly model: string;
  readonly usage: NonNullable<TextGenerationUsageReport["usage"]>;
} | null {
  let named: { model: string; rateModel: string } | undefined;
  let costUsd = 0;
  const totals = {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  for (const candidate of messages) {
    const message = Option.getOrUndefined(decodeAssistantMessage(candidate));
    if (message === undefined) continue;
    const rateModel = message.responseModel ?? message.model;
    named = { model: `${message.provider}/${rateModel}`, rateModel };
    const { usage } = message;
    const output = tokenCount(usage.output);
    // Pi's input/cache counters are already disjoint.
    totals.uncachedInputTokens += tokenCount(usage.input);
    totals.cachedInputTokens += tokenCount(usage.cacheRead);
    totals.cacheCreationTokens += tokenCount(usage.cacheWrite);
    totals.outputTokens += output;
    totals.reasoningTokens += Math.min(output, tokenCount(usage.reasoning));
    const cost = usage.cost?.total;
    if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) costUsd += cost;
  }
  if (named === undefined || (totalTokens(totals) === 0 && costUsd === 0)) return null;
  return {
    model: named.model,
    usage: {
      totals,
      // Pi prices models missing from its catalog at zero; leave those to shared pricing.
      reportedCostUsd: costUsd > 0 ? costUsd : null,
      rateModel: named.rateModel,
    },
  };
}
