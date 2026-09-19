import type { GitHubAccountRule, SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  accountOptions,
  addRule,
  inheritedAccountLabel,
  moveRule,
  removeRule,
  summarizeRules,
  updateRule,
  validateOwnerPattern,
} from "./gitHubAccountSettings.logic";

const rule = (owner: string, login: string, host = "github.com"): GitHubAccountRule => ({
  host,
  owner,
  login,
});

const discovery = (
  accounts: ReadonlyArray<{ login: string; active?: boolean; authenticated?: boolean }>,
): SourceControlDiscoveryResult => ({
  versionControlSystems: [],
  sourceControlProviders: [
    {
      kind: "github",
      label: "GitHub",
      status: "available",
      version: Option.none(),
      installHint: "",
      detail: Option.none(),
      auth: {
        status: "authenticated",
        account: Option.some(accounts[0]?.login ?? "nobody"),
        host: Option.some("github.com"),
        detail: Option.none(),
        accounts: accounts.map((account) => ({
          host: "github.com",
          login: account.login,
          active: account.active ?? false,
          authenticated: account.authenticated ?? true,
        })),
      },
    },
  ],
});

describe("accountOptions", () => {
  it("lists the authenticated GitHub accounts with the active one flagged", () => {
    expect(
      accountOptions(
        discovery([
          { login: "personal", active: true },
          { login: "work" },
          { login: "expired", authenticated: false },
        ]),
      ),
    ).toEqual([
      { login: "personal", host: "github.com", active: true },
      { login: "work", host: "github.com", active: false },
    ]);
  });

  it("is empty when the server predates account lists", () => {
    const result = discovery([{ login: "personal" }]);
    const { accounts: _accounts, ...auth } = result.sourceControlProviders[0]!.auth;
    expect(
      accountOptions({
        ...result,
        sourceControlProviders: [{ ...result.sourceControlProviders[0]!, auth }],
      }),
    ).toEqual([]);
  });
});

describe("rule list edits", () => {
  const rules = [rule("acme", "personal"), rule("geico-*", "work"), rule("*", "personal")];

  it("adds, updates, and removes rules without touching the others", () => {
    expect(addRule(rules, rule("late", "work"))).toEqual([...rules, rule("late", "work")]);
    expect(updateRule(rules, 1, { login: "personal" })).toEqual([
      rules[0],
      rule("geico-*", "personal"),
      rules[2],
    ]);
    expect(removeRule(rules, 0)).toEqual([rules[1], rules[2]]);
    expect(removeRule(rules, 5)).toEqual(rules);
  });

  it("moves a rule up or down and clamps at the ends", () => {
    expect(moveRule(rules, 1, -1)).toEqual([rules[1], rules[0], rules[2]]);
    expect(moveRule(rules, 1, 1)).toEqual([rules[0], rules[2], rules[1]]);
    expect(moveRule(rules, 0, -1)).toEqual(rules);
    expect(moveRule(rules, 2, 1)).toEqual(rules);
  });
});

describe("validateOwnerPattern", () => {
  it("accepts owner names and * wildcards and rejects everything else", () => {
    expect(validateOwnerPattern("geico-*")).toBeNull();
    expect(validateOwnerPattern("Ping.Dot_GG")).toBeNull();
    expect(validateOwnerPattern("*")).toBeNull();
    expect(validateOwnerPattern("")).toBe("Enter an owner name or pattern.");
    expect(validateOwnerPattern("   ")).toBe("Enter an owner name or pattern.");
    expect(validateOwnerPattern("geico/private")).toBe(
      "Use letters, digits, dots, dashes, underscores, and * only.",
    );
    expect(validateOwnerPattern("a b")).toBe(
      "Use letters, digits, dots, dashes, underscores, and * only.",
    );
  });
});

describe("summarizeRules", () => {
  it("says Off for no rules and counts the rest with the first mapping", () => {
    expect(summarizeRules([])).toBe("Off");
    expect(summarizeRules([rule("geico-*", "work")])).toBe("1 rule: geico-* uses work");
    expect(summarizeRules([rule("geico-*", "work"), rule("*", "personal")])).toBe(
      "2 rules: geico-* uses work",
    );
  });
});

describe("inheritedAccountLabel", () => {
  const accounts = accountOptions(
    discovery([{ login: "personal", active: true }, { login: "work" }]),
  );

  it("names the matching rule's account", () => {
    expect(
      inheritedAccountLabel({
        rules: [rule("geico-*", "work")],
        host: "github.com",
        owner: "geico-private",
        accounts,
      }),
    ).toBe("Inherits work (rule geico-*).");
  });

  it("falls back to the active gh account when no rule matches", () => {
    expect(
      inheritedAccountLabel({
        rules: [rule("geico-*", "work")],
        host: "github.com",
        owner: "pingdotgg",
        accounts,
      }),
    ).toBe("Inherits the active gh account (personal).");
    expect(
      inheritedAccountLabel({ rules: [], host: "github.com", owner: "pingdotgg", accounts: [] }),
    ).toBe("Inherits the active gh account.");
  });

  it("warns when the matched login is not signed in", () => {
    expect(
      inheritedAccountLabel({
        rules: [rule("*", "old-login")],
        host: "github.com",
        owner: "pingdotgg",
        accounts,
      }),
    ).toBe("Inherits old-login (rule *), which is not signed in on this machine.");
  });
});
