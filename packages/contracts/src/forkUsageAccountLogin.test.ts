import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { UsageLimitSourceAccountLoginInput } from "./forkUsageAccountLogin.ts";
import { UsageLimitSourceSnapshot } from "./providerUsageLimits.ts";

const decodeInput = Schema.decodeUnknownSync(UsageLimitSourceAccountLoginInput);
const decodeSnapshot = Schema.decodeUnknownSync(UsageLimitSourceSnapshot);

describe("UsageLimitSourceAccountLoginInput", () => {
  it("requires a code to submit", () => {
    expect(() =>
      decodeInput({ sourceId: "iris", account: "claude-1", action: "submit" }),
    ).toThrow();
    expect(() =>
      decodeInput({ sourceId: "iris", account: "claude-1", action: "submit", code: "  " }),
    ).toThrow();
  });
});

describe("UsageLimitSourceProxyStatus.accountLogins", () => {
  it("carries a gateway's open logins on the published snapshot", () => {
    const snapshot = decodeSnapshot({
      id: "iris",
      kind: "modelproxy",
      label: "iris",
      checkedAt: "2026-10-06T12:00:00.000Z",
      accounts: [],
      proxy: {
        auth: { state: "signedIn" },
        accountLogins: [
          {
            account: "codex-1",
            sessionId: "s1",
            mode: "device",
            state: "awaiting_approval",
            userCode: "ABCD-EFGH",
            verificationUrl: "https://auth.openai.com/codex/device",
            expiresAt: "2026-10-06T12:15:00.000Z",
          },
        ],
      },
    });
    expect(snapshot.proxy?.accountLogins?.[0]?.userCode).toBe("ABCD-EFGH");
  });
});
