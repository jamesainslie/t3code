import type { GitHubAccountRule } from "@t3tools/contracts";

/** `*` matches any run of characters; everything else is literal. Case-insensitive, whole-owner match. */
export function matchesOwnerPattern(pattern: string, owner: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "i").test(owner);
}

export interface ResolveGitHubAccountInput {
  readonly rules: ReadonlyArray<GitHubAccountRule>;
  readonly projectOverride: string | undefined;
  readonly host: string;
  readonly owner: string;
}

/** Which rule (by index) "inherit" resolves to, or null when gh's active account applies. */
export function matchingRuleIndex(
  rules: ReadonlyArray<GitHubAccountRule>,
  host: string,
  owner: string,
): number | null {
  const wanted = host.toLowerCase();
  const index = rules.findIndex(
    (rule) => rule.host.toLowerCase() === wanted && matchesOwnerPattern(rule.owner, owner),
  );
  return index === -1 ? null : index;
}

/** Project override, then the first matching rule, then null for gh's active account. */
export function resolveGitHubAccount(input: ResolveGitHubAccountInput): string | null {
  if (input.projectOverride !== undefined) return input.projectOverride;
  const index = matchingRuleIndex(input.rules, input.host, input.owner);
  return index === null ? null : (input.rules[index]?.login ?? null);
}
