import type { GitHubAccountRule } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  matchesOwnerPattern,
  matchingRuleIndex,
  resolveGitHubAccount,
} from "./gitHubAccountRouting.ts";

const rule = (owner: string, login: string, host = "github.com"): GitHubAccountRule => ({
  host,
  owner,
  login,
});

describe("matchesOwnerPattern", () => {
  it("matches exact owners case-insensitively", () => {
    expect(matchesOwnerPattern("pingdotgg", "pingdotgg")).toBe(true);
    expect(matchesOwnerPattern("PingDotGG", "pingdotgg")).toBe(true);
    expect(matchesOwnerPattern("pingdotgg", "pingdotgg-labs")).toBe(false);
  });

  it("treats * as a run of any characters anchored to the whole owner", () => {
    expect(matchesOwnerPattern("geico-*", "geico-private")).toBe(true);
    expect(matchesOwnerPattern("geico-*", "GEICO-Sandbox")).toBe(true);
    expect(matchesOwnerPattern("geico-*", "mygeico-x")).toBe(false);
    expect(matchesOwnerPattern("*", "anything-at-all")).toBe(true);
    expect(matchesOwnerPattern("*-labs", "acme-labs")).toBe(true);
  });

  it("keeps regex metacharacters literal", () => {
    expect(matchesOwnerPattern("a.b", "a.b")).toBe(true);
    expect(matchesOwnerPattern("a.b", "axb")).toBe(false);
  });
});

describe("resolveGitHubAccount", () => {
  const rules = [rule("geico-*", "work"), rule("*", "personal")];

  it("lets a project override win over a matching rule", () => {
    expect(
      resolveGitHubAccount({
        rules,
        projectOverride: "other",
        host: "github.com",
        owner: "geico-private",
      }),
    ).toBe("other");
  });

  it("picks the first matching rule", () => {
    expect(
      resolveGitHubAccount({
        rules,
        projectOverride: undefined,
        host: "github.com",
        owner: "geico-private",
      }),
    ).toBe("work");
    expect(
      resolveGitHubAccount({
        rules,
        projectOverride: undefined,
        host: "github.com",
        owner: "pingdotgg",
      }),
    ).toBe("personal");
  });

  it("skips rules for another host", () => {
    expect(
      resolveGitHubAccount({
        rules: [rule("geico-*", "work", "github.geico.net")],
        projectOverride: undefined,
        host: "github.com",
        owner: "geico-private",
      }),
    ).toBeNull();
    expect(
      resolveGitHubAccount({
        rules: [rule("geico-*", "work", "GitHub.com")],
        projectOverride: undefined,
        host: "github.com",
        owner: "geico-private",
      }),
    ).toBe("work");
  });

  it("returns null when nothing matches", () => {
    expect(
      resolveGitHubAccount({
        rules: [rule("geico-*", "work")],
        projectOverride: undefined,
        host: "github.com",
        owner: "pingdotgg",
      }),
    ).toBeNull();
    expect(
      resolveGitHubAccount({
        rules: [],
        projectOverride: undefined,
        host: "github.com",
        owner: "x",
      }),
    ).toBeNull();
  });
});

describe("matchingRuleIndex", () => {
  it("returns the index of the first matching rule or null", () => {
    const rules = [rule("acme", "a"), rule("geico-*", "work"), rule("geico-private", "late")];
    expect(matchingRuleIndex(rules, "github.com", "geico-private")).toBe(1);
    expect(matchingRuleIndex(rules, "github.com", "nobody")).toBeNull();
    expect(matchingRuleIndex(rules, "github.geico.net", "geico-private")).toBeNull();
  });
});
