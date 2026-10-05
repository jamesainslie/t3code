import type { OrchestrationV2TurnItem } from "@t3tools/contracts";

/**
 * Fork: thinking is presented apart from tool calls. A thought never shares a
 * work group with anything else, so the timeline reads as alternating thoughts
 * and tool groups instead of folding the agent's reasoning into "Ran N commands".
 * Web and mobile both group with this rule.
 */
export function thinkingSplitsWorkGroup(
  previousItemType: string | undefined,
  nextItemType: string | undefined,
): boolean {
  return previousItemType === "reasoning" || nextItemType === "reasoning";
}

/**
 * Narrows a projection's items to the pending requests plus the provider turns
 * their questions came from, so `questionLeadIn` still finds the lead-in when
 * a caller keeps only request items to avoid rederiving on unrelated output.
 */
export function withQuestionLeadInItems(
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
  requestItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<OrchestrationV2TurnItem> {
  const questionTurns = new Set(
    requestItems.flatMap((item) =>
      item.type === "user_input_request" && item.providerTurnId !== null
        ? [item.providerTurnId]
        : [],
    ),
  );
  if (questionTurns.size === 0) return requestItems;
  const requests = new Set(requestItems);
  return turnItems.filter(
    (item) =>
      requests.has(item) ||
      (item.providerTurnId !== null && questionTurns.has(item.providerTurnId)),
  );
}

/**
 * The reasoning the agent wrote right before asking a question, oldest first.
 * Claude often puts the question's explanation in a thinking block, so without
 * this the question panel shows options with none of the context behind them.
 * Within the request's provider turn it walks back from the request, skipping
 * the still-running tool call that raised it, and stops at anything else.
 */
export function questionLeadIn(
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
  request: OrchestrationV2TurnItem,
): string | undefined {
  if (request.providerTurnId === null) return undefined;
  const earlier = turnItems
    .filter(
      (item) =>
        item.runId === request.runId &&
        item.providerTurnId === request.providerTurnId &&
        item.ordinal < request.ordinal,
    )
    // filter returns a fresh array; Hermes (mobile) has no toSorted.
    .sort((a, b) => a.ordinal - b.ordinal);
  const thoughts: string[] = [];
  for (let index = earlier.length - 1; index >= 0; index -= 1) {
    const item = earlier[index]!;
    if (item.type === "reasoning") {
      const text = item.text.trim();
      if (text) thoughts.unshift(text);
      continue;
    }
    if (thoughts.length === 0 && item.type === "dynamic_tool" && item.status !== "completed") {
      continue;
    }
    break;
  }
  return thoughts.length > 0 ? thoughts.join("\n\n") : undefined;
}
