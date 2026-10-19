/**
 * Fork: background generation usage. A text-generation runner reports which
 * provider session answered, and the tokens it used when the provider keeps
 * no record of the call itself. The server provides the reporter around each
 * call and knows what the call was for; without one, reports go nowhere.
 */
import type { UsageProviderKind, UsageTokenTotals } from "@lathe/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { tokenCount, type UsageSpeed } from "./usage.ts";

export interface TextGenerationUsageReport {
  readonly provider: UsageProviderKind;
  /** The id the provider's own usage history files the call under. */
  readonly sessionId: string;
  readonly model: string;
  /**
   * Only for a call the provider's usage history will never contain (an
   * ephemeral or deleted session). Reporting usage for a call that history
   * also holds counts it twice.
   */
  readonly usage?: {
    readonly totals: UsageTokenTotals;
    readonly reportedCostUsd: number | null;
    readonly speed?: UsageSpeed;
    /** As on `UsageRecord`: the name rates are looked up under, when `model` is not it. */
    readonly rateModel?: string;
  };
}

export class TextGenerationUsageReporter extends Context.Reference<{
  readonly report: (report: TextGenerationUsageReport) => Effect.Effect<void>;
}>("lathe/provider-core/TextGenerationUsageReporter", {
  defaultValue: () => ({ report: () => Effect.void }),
}) {}

export const reportTextGenerationUsage = (report: TextGenerationUsageReport) =>
  TextGenerationUsageReporter.pipe(Effect.flatMap((reporter) => reporter.report(report)));

/**
 * Totals from an input count that includes cache reads and writes, the way
 * most providers report it.
 */
export function totalsFromInclusiveInput(input: {
  readonly input: unknown;
  readonly cacheRead?: unknown;
  readonly cacheWrite?: unknown;
  readonly output: unknown;
  readonly reasoning?: unknown;
}): UsageTokenTotals {
  const cachedInputTokens = tokenCount(input.cacheRead);
  const cacheCreationTokens = tokenCount(input.cacheWrite);
  return {
    uncachedInputTokens: Math.max(
      0,
      tokenCount(input.input) - cachedInputTokens - cacheCreationTokens,
    ),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens: tokenCount(input.output),
    reasoningTokens: tokenCount(input.reasoning),
  };
}
