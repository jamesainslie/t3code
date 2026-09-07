import { describe, expect, it } from "vite-plus/test";

import { terminalBrowserLaunchRelayMode } from "./terminalBrowserLaunch.ts";

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
