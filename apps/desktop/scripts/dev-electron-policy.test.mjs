import { describe, expect, it } from "vitest";

import { shouldRestartExitedApp } from "./dev-electron-policy.mjs";

describe("shouldRestartExitedApp", () => {
  it("restarts after an unexpected clean Electron exit", () => {
    expect(
      shouldRestartExitedApp({
        code: 0,
        expectedExit: false,
        shuttingDown: false,
        signal: null,
      }),
    ).toBe(true);
  });

  it("restarts after an unexpected abnormal Electron exit", () => {
    expect(
      shouldRestartExitedApp({
        code: 1,
        expectedExit: false,
        shuttingDown: false,
        signal: null,
      }),
    ).toBe(true);
    expect(
      shouldRestartExitedApp({
        code: null,
        expectedExit: false,
        shuttingDown: false,
        signal: "SIGTERM",
      }),
    ).toBe(true);
  });

  it("does not restart exits initiated by the launcher", () => {
    expect(
      shouldRestartExitedApp({
        code: 0,
        expectedExit: true,
        shuttingDown: false,
        signal: null,
      }),
    ).toBe(false);
    expect(
      shouldRestartExitedApp({
        code: 0,
        expectedExit: false,
        shuttingDown: true,
        signal: null,
      }),
    ).toBe(false);
  });
});
