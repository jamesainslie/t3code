import type {
  GitHubAccountRule,
  GitHubAccountRules,
  SourceControlDiscoveryResult,
} from "@t3tools/contracts";
import { matchingRuleIndex } from "@t3tools/shared/gitHubAccountRouting";

export interface GitHubAccountOption {
  readonly login: string;
  readonly host: string;
  readonly active: boolean;
}

/** The signed-in GitHub accounts the environment's `gh` knows; empty on servers without account lists. */
export function accountOptions(
  discovery: SourceControlDiscoveryResult,
): ReadonlyArray<GitHubAccountOption> {
  const github = discovery.sourceControlProviders.find((item) => item.kind === "github");
  return (github?.auth.accounts ?? [])
    .filter((account) => account.authenticated)
    .map((account) => ({ login: account.login, host: account.host, active: account.active }));
}

export function addRule(rules: GitHubAccountRules, rule: GitHubAccountRule): GitHubAccountRules {
  return [...rules, rule];
}

export function removeRule(rules: GitHubAccountRules, index: number): GitHubAccountRules {
  return rules.filter((_, position) => position !== index);
}

/** Swaps the rule with its neighbour in `direction`; a move past either end changes nothing. */
export function moveRule(
  rules: GitHubAccountRules,
  index: number,
  direction: -1 | 1,
): GitHubAccountRules {
  const target = index + direction;
  if (index < 0 || index >= rules.length || target < 0 || target >= rules.length) return rules;
  const next = [...rules];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

export function updateRule(
  rules: GitHubAccountRules,
  index: number,
  patch: Partial<GitHubAccountRule>,
): GitHubAccountRules {
  return rules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule));
}

/** Same grammar as the contracts schema: letters, digits, dots, dashes, underscores, and `*`. */
const OWNER_PATTERN = /^[A-Za-z0-9._*-]+$/;

/** The validation message for an owner pattern, or null when it is acceptable. */
export function validateOwnerPattern(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "Enter an owner name or pattern.";
  if (!OWNER_PATTERN.test(trimmed)) {
    return "Use letters, digits, dots, dashes, underscores, and * only.";
  }
  return null;
}

export function summarizeRules(rules: GitHubAccountRules): string {
  const first = rules[0];
  if (first === undefined) return "Off";
  const count = rules.length === 1 ? "1 rule" : `${rules.length} rules`;
  return `${count}: ${first.owner} uses ${first.login}`;
}

/** What "Inherit" resolves to for one repository, for the project override row's description. */
export function inheritedAccountLabel(input: {
  readonly rules: GitHubAccountRules;
  readonly host: string;
  readonly owner: string;
  readonly accounts: ReadonlyArray<GitHubAccountOption>;
}): string {
  const index = matchingRuleIndex(input.rules, input.host, input.owner);
  if (index === null) {
    const active = input.accounts.find((account) => account.active);
    return active === undefined
      ? "Inherits the active gh account."
      : `Inherits the active gh account (${active.login}).`;
  }
  const rule = input.rules[index]!;
  const signedIn = input.accounts.some(
    (account) => account.login.toLowerCase() === rule.login.toLowerCase(),
  );
  return signedIn
    ? `Inherits ${rule.login} (rule ${rule.owner}).`
    : `Inherits ${rule.login} (rule ${rule.owner}), which is not signed in on this machine.`;
}
