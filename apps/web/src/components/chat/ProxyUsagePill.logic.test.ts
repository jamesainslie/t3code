import { UsageLimitSourceId, type UsageLimitSourceSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveProxyPill,
  formatCountdownSeconds,
  looksLikeEmailCode,
  selectProxySource,
} from "./ProxyUsagePill.logic";

const now = Date.parse("2026-09-23T12:00:00Z");
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString();

function account(
  id: string,
  windows: Array<[id: string, usedPercent: number, resetsAt?: string]>,
  proxy: NonNullable<UsageLimitSourceSnapshot["accounts"][number]["proxy"]>,
): UsageLimitSourceSnapshot["accounts"][number] {
  return {
    id,
    driver: "claudeAgent" as never,
    usageLimits: {
      checkedAt: at(0),
      windows: windows.map(([windowId, usedPercent, resetsAt]) => ({
        id: windowId,
        kind: windowId === "five_hour" ? ("session" as const) : ("weekly" as const),
        label: windowId,
        usedPercent,
        ...(resetsAt ? { resetsAt } : {}),
      })),
    },
    proxy,
  };
}

function snapshot(overrides: Partial<UsageLimitSourceSnapshot> = {}): UsageLimitSourceSnapshot {
  return {
    id: UsageLimitSourceId.make("modelproxy-iris"),
    kind: "modelproxy",
    label: "iris",
    checkedAt: at(0),
    accounts: [
      account(
        "james-max",
        [
          ["five_hour", 62, at(2)],
          ["seven_day", 41, at(100)],
        ],
        {
          state: "live",
          inflight: 2,
        },
      ),
      account(
        "zeus-pro",
        [
          ["five_hour", 96, at(1.7)],
          ["seven_day", 58, at(90)],
        ],
        {
          state: "ready",
          inflight: 0,
        },
      ),
    ],
    proxy: {
      auth: { state: "signedIn" },
      current: "james-max",
      rotationThresholdPercent: 90,
      modelThresholdPercent: 85,
      runway: { kind: "at", at: at(4.34) },
      fallback: [{ name: "openrouter-main", provider: "openrouter", spendUsd: 3.4, window: "day" }],
      inflightTotal: 2,
      queueDepth: 0,
    },
    ...overrides,
  };
}

describe("selectProxySource", () => {
  const gateway = snapshot();
  const hub = { ...snapshot(), kind: "cliproxy" as const };

  it("prefers the thread's environment, then the primary, then any other", () => {
    const configs = new Map([
      ["mac", { usageLimitSources: [gateway] }],
      ["hephaestus", { usageLimitSources: [hub] }],
      ["incus", { usageLimitSources: [gateway] }],
    ]);
    expect(selectProxySource(configs, ["hephaestus", "mac"])?.environmentId).toBe("mac");
    expect(selectProxySource(configs, ["incus", "mac"])?.environmentId).toBe("incus");
    expect(selectProxySource(configs, ["hephaestus", null])?.environmentId).toBe("mac");
  });

  it("returns null when no environment has a gateway", () => {
    const configs = new Map([
      ["hephaestus", { usageLimitSources: [hub] }],
      ["mac", {}],
    ]);
    expect(selectProxySource(configs, ["hephaestus", "mac"])).toBeNull();
  });
});

describe("deriveProxyPill", () => {
  it("ignores sources that are not a gateway", () => {
    expect(deriveProxyPill({ ...snapshot(), kind: "cliproxy" }, now)).toBeNull();
  });

  it("shows the serving account, its session tone, and the fleet runway", () => {
    const pill = deriveProxyPill(snapshot(), now)!;
    expect(pill.status).toBe("live");
    expect(pill.current?.id).toBe("james-max");
    expect(pill.current?.headline).toBe("62%");
    expect(pill.current?.stateLabel).toBe("live now · 2 in flight");
    expect(pill.tone).toBe("warn");
    expect(pill.runwayText).toBe("4h 20m");
    expect(pill.fallbackText).toBeNull();
    expect(pill.footer).toBe("threshold 90% · model 85% · 2 in flight");
  });

  it("lets a spent shared window govern the account's runway", () => {
    const pill = deriveProxyPill(snapshot(), now)!;
    const zeus = pill.accounts[1]!;
    expect(zeus.stateLabel).toBe("5h spent");
    expect(zeus.stateTone).toBe("crit");
    expect(zeus.runwayText).toBe("1h 42m");
    expect(zeus.windows[0]?.tone).toBe("crit");
  });

  it("keeps an account on credits selectable but warns", () => {
    const pill = deriveProxyPill(
      snapshot({
        accounts: [
          account("codex-james", [["five_hour", 100, at(1)]], {
            state: "ready",
            inflight: 0,
            credits: true,
          }),
        ],
        proxy: { auth: { state: "signedIn" }, current: "codex-james" },
      }),
      now,
    )!;
    expect(pill.accounts[0]?.stateLabel).toBe("on credits");
    expect(pill.accounts[0]?.runwayText).toBe("credits");
  });

  it("reports the fallback spend once the whole pool is spent", () => {
    const pill = deriveProxyPill(
      snapshot({
        accounts: [
          account("james-max", [["five_hour", 100, at(2)]], { state: "ready", inflight: 0 }),
          account("zeus-pro", [["five_hour", 96, at(1.7)]], {
            state: "cooling",
            inflight: 0,
            coolingUntil: at(0.01),
          }),
        ],
        proxy: { ...snapshot().proxy!, current: undefined },
      }),
      now,
    )!;
    expect(pill.current).toBeNull();
    expect(pill.tone).toBe("crit");
    expect(pill.fallbackText).toBe("$3.40 today");
  });

  it("surfaces sign-in state and the pending code", () => {
    const signedOut = deriveProxyPill(
      snapshot({ accounts: [], error: "Not signed in.", proxy: { auth: { state: "signedOut" } } }),
      now,
    )!;
    expect(signedOut.status).toBe("signedOut");
    expect(signedOut.pending).toBeNull();
    const pending = deriveProxyPill(
      snapshot({
        accounts: [],
        error: "Sign-in pending.",
        proxy: {
          auth: {
            state: "pending",
            userCode: "ABCD-EFGH",
            verificationUrl: "https://auth.test/device",
            verificationUrlComplete: "https://auth.test/device?user_code=ABCD-EFGH",
            expiresAt: at(0.1),
          },
        },
      }),
      now,
    )!;
    expect(pending.status).toBe("pending");
    expect(pending.pending).toEqual({
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.test/device?user_code=ABCD-EFGH",
      expiresAt: at(0.1),
    });
  });

  it("counts down to the second when asked, so a watcher sees the clock move", () => {
    expect(formatCountdownSeconds(3 * 86_400_000 + 4 * 3_600_000 + 5_000)).toBe("3d 04h");
    expect(formatCountdownSeconds(19 * 3_600_000 + 17 * 60_000 + 9_000)).toBe("19:17:09");
    expect(formatCountdownSeconds(42_000)).toBe("0:00:42");
    const pill = deriveProxyPill(snapshot(), now, { seconds: true })!;
    expect(pill.accounts[1]?.runwayText).toBe("1:42:00");
    expect(pill.runwayText).toBe("4:20:24");
    // Off by default: the header pill ticks by the minute and reads the short form.
    expect(deriveProxyPill(snapshot(), now)!.accounts[1]?.runwayText).toBe("1h 42m");
  });

  it("counts down to every window's reset, not only the one that comes first", () => {
    const pill = deriveProxyPill(snapshot(), now, { seconds: true })!;
    // The runway follows the sooner session reset; the weekly reset still gets its own clock.
    expect(pill.accounts[1]?.windows.map((window) => [window.label, window.resetText])).toEqual([
      ["5h", "1:42:00"],
      ["7d", "3d 18h"],
    ]);
    const unknown = deriveProxyPill(
      snapshot({ accounts: [account("new", [["seven_day", 5]], { state: "ready", inflight: 0 })] }),
      now,
      { seconds: true },
    )!;
    expect(unknown.accounts[0]?.windows[0]?.resetText).toBe("");
  });

  it("marks a signed-in source that failed to read as offline", () => {
    const pill = deriveProxyPill(
      snapshot({ accounts: [], error: "The gateway did not answer." }),
      now,
    )!;
    expect(pill.status).toBe("offline");
    expect(pill.error).toBe("The gateway did not answer.");
    expect(pill.tone).toBe("muted");
  });
});

describe("account logins", () => {
  const flagged = (logins?: NonNullable<UsageLimitSourceSnapshot["proxy"]>["accountLogins"]) =>
    snapshot({
      accounts: [
        account("claude-1", [], { state: "reauthentication", inflight: 0 }),
        account("james-max", [["five_hour", 10, at(2)]], { state: "live", inflight: 0 }),
      ],
      proxy: {
        auth: { state: "signedIn" },
        current: "james-max",
        ...(logins ? { accountLogins: logins } : {}),
      },
    });
  const login = {
    account: "claude-1",
    sessionId: "s1",
    mode: "paste" as const,
    state: "awaiting_code" as const,
    authorizeUrl: "https://claude.com/cai/oauth/authorize",
    expiresAt: at(0.2),
  };

  it("counts the accounts that need a login and marks their rows", () => {
    const pill = deriveProxyPill(flagged(), now)!;
    expect(pill.needsLogin).toBe(1);
    expect(pill.accounts[0]!.needsLogin).toBe(true);
    expect(pill.accounts[0]!.login).toBeNull();
    expect(pill.accounts[1]!.needsLogin).toBe(false);
  });

  it("asks for the pasted code, and says what to do when one is refused", () => {
    const waiting = deriveProxyPill(flagged([login]), now)!.accounts[0]!.login!;
    expect(waiting.step).toBe("paste");
    expect(waiting.authorizeUrl).toBe(login.authorizeUrl);
    expect(waiting.message).toBeNull();

    const refused = deriveProxyPill(
      flagged([{ ...login, errorCode: "bad_code", error: "that code did not work" }]),
      now,
    )!.accounts[0]!.login!;
    expect(refused.step).toBe("paste");
    expect(refused.message).toMatch(/didn't work/);
  });

  it("explains an emailed sign-in code, and relays codes it does not know", () => {
    const email = deriveProxyPill(
      flagged([{ ...login, errorCode: "email_code", error: "gateway words" }]),
      now,
    )!.accounts[0]!.login!;
    expect(email.step).toBe("paste");
    expect(email.message).toMatch(/sign-in page/);

    const unknown = deriveProxyPill(
      flagged([{ ...login, errorCode: "something_new", error: "the gateway says why" }]),
      now,
    )!.accounts[0]!.login!;
    expect(unknown.message).toBe("the gateway says why");
  });

  it("recognises a pasted email sign-in code before sending it", () => {
    expect(looksLikeEmailCode("251063")).toBe(true);
    expect(looksLikeEmailCode(" 2510-63 ")).toBe(true);
    expect(looksLikeEmailCode("abcDEF123#xyz")).toBe(false);
    expect(looksLikeEmailCode("12")).toBe(false);
  });

  it("shows a device code to approve, then the outcome", () => {
    const device = {
      ...login,
      mode: "device" as const,
      state: "awaiting_approval" as const,
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
    };
    const approve = deriveProxyPill(flagged([device]), now)!.accounts[0]!.login!;
    expect(approve.step).toBe("approve");
    expect(approve.userCode).toBe("ABCD-EFGH");

    const mismatch = deriveProxyPill(
      flagged([
        {
          ...device,
          state: "failed",
          errorCode: "identity_mismatch",
          error: "signed in as other@example.com",
        },
      ]),
      now,
    )!.accounts[0]!.login!;
    expect(mismatch.step).toBe("failed");
    expect(mismatch.message).toBe("signed in as other@example.com");

    const saved = deriveProxyPill(
      flagged([{ ...device, state: "completed", errorCode: "save_failed" }]),
      now,
    )!.accounts[0]!.login!;
    expect(saved.step).toBe("done");
    expect(saved.message).toMatch(/restart/);
  });
});
