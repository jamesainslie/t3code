import { UsageLimitSourceId, type UsageLimitSourceSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProxyPill } from "./ProxyUsagePill.logic";

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
