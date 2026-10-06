import { describe, expect, it } from "vite-plus/test";

import { loginAlerts } from "./proxyLoginAlerts.logic";

describe("loginAlerts", () => {
  it("only mentions accounts already flagged when the app first looks", () => {
    expect(loginAlerts(null, ["claude-1"])).toEqual({ notify: [], mention: ["claude-1"] });
    expect(loginAlerts(null, [])).toEqual({ notify: [], mention: [] });
  });

  it("notifies for an account that newly needs a login", () => {
    expect(loginAlerts(new Set(["claude-1"]), ["claude-1", "codex-1"])).toEqual({
      notify: ["codex-1"],
      mention: [],
    });
  });

  it("stays quiet while nothing new is flagged, and again after a fix", () => {
    expect(loginAlerts(new Set(["claude-1"]), ["claude-1"])).toEqual({ notify: [], mention: [] });
    expect(loginAlerts(new Set(["claude-1"]), [])).toEqual({ notify: [], mention: [] });
    // Flagged again after it was fixed: that is news.
    expect(loginAlerts(new Set([]), ["claude-1"])).toEqual({ notify: ["claude-1"], mention: [] });
  });
});
