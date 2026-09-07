import { describe, expect, it } from "vite-plus/test";

import {
  nextTerminalBrowserLaunchExpiry,
  pendingTerminalBrowserLaunches,
  terminalBrowserLaunchRelayMode,
} from "./terminalBrowserLaunch.ts";

describe("terminalBrowserLaunchRelayMode", () => {
  const redirectUri = "http://localhost:47822/";

  it("hosts the listener once the desktop holds the port", () => {
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "query", redirectUri, hosted: true }),
    ).toBe("hosted");
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "form_post", redirectUri, hosted: true }),
    ).toBe("hosted");
  });

  it("falls back to pasting the return URL for a query response", () => {
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "query", redirectUri, hosted: false }),
    ).toBe("paste");
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "query", redirectUri, hosted: null }),
    ).toBe("paste");
    // A capture with no advertised listener cannot be hosted, whatever the desktop says.
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "query", redirectUri: null, hosted: true }),
    ).toBe("paste");
  });

  it("treats a missing response mode as a query response", () => {
    expect(terminalBrowserLaunchRelayMode({ redirectUri, hosted: false })).toBe("paste");
    expect(terminalBrowserLaunchRelayMode({ redirectUri: null, hosted: null })).toBe("paste");
  });

  it("has nothing to paste when the response is a form post nobody here can catch", () => {
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "form_post", redirectUri, hosted: false }),
    ).toBe("unreachable");
    expect(
      terminalBrowserLaunchRelayMode({ responseMode: "form_post", redirectUri, hosted: null }),
    ).toBe("unreachable");
  });
});

describe("pendingTerminalBrowserLaunches", () => {
  const now = Date.parse("2026-04-01T00:05:00.000Z");
  const live = { captureId: "live", expiresAt: "2026-04-01T00:06:00.000Z" };
  const expired = { captureId: "expired", expiresAt: "2026-04-01T00:04:59.000Z" };
  const unreadable = { captureId: "unreadable", expiresAt: "soon" };

  it("drops a launch once the server has forgotten it", () => {
    expect(pendingTerminalBrowserLaunches([live, expired], now)).toEqual([live]);
    // Expiry is exclusive: the deadline itself is already too late.
    expect(
      pendingTerminalBrowserLaunches([{ ...live, expiresAt: "2026-04-01T00:05:00.000Z" }], now),
    ).toEqual([]);
  });

  it("returns the same array while every launch is still pending", () => {
    const launches = [live, unreadable];
    expect(pendingTerminalBrowserLaunches(launches, now)).toBe(launches);
  });
});

describe("nextTerminalBrowserLaunchExpiry", () => {
  const now = Date.parse("2026-04-01T00:05:00.000Z");

  it("measures to the soonest readable deadline and never goes negative", () => {
    expect(
      nextTerminalBrowserLaunchExpiry(
        [
          { expiresAt: "2026-04-01T00:07:00.000Z" },
          { expiresAt: "2026-04-01T00:05:30.000Z" },
          { expiresAt: "later" },
        ],
        now,
      ),
    ).toBe(30_000);
    expect(nextTerminalBrowserLaunchExpiry([{ expiresAt: "2026-04-01T00:04:00.000Z" }], now)).toBe(
      0,
    );
  });

  it("has nothing to wait for without a readable deadline", () => {
    expect(nextTerminalBrowserLaunchExpiry([], now)).toBeNull();
    expect(nextTerminalBrowserLaunchExpiry([{ expiresAt: "later" }], now)).toBeNull();
  });
});
