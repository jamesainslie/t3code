import { describe, expect, it } from "vite-plus/test";

import { adoptLegacyEnv, legacyEnvWarning, withLegacyExportedNames } from "./forkLegacyEnv.ts";

describe("adoptLegacyEnv", () => {
  it("moves pre-rename variables to their Lathe names", () => {
    const env: Record<string, string | undefined> = {
      T3CODE_HOME: "/srv/lathe",
      VITE_T3CODE_RELAY_URL: "wss://relay.example",
      PATH: "/usr/bin",
    };
    expect(adoptLegacyEnv(env)).toEqual(["T3CODE_HOME", "VITE_T3CODE_RELAY_URL"]);
    expect(env).toEqual({
      LATHE_HOME: "/srv/lathe",
      VITE_LATHE_RELAY_URL: "wss://relay.example",
      PATH: "/usr/bin",
    });
  });

  it("keeps a Lathe name that is already set", () => {
    const env: Record<string, string | undefined> = { T3CODE_PORT: "1", LATHE_PORT: "2" };
    adoptLegacyEnv(env);
    expect(env).toEqual({ LATHE_PORT: "2" });
  });

  it("leaves names that only look similar", () => {
    const env: Record<string, string | undefined> = { MY_T3CODE_HOME: "x", T3_MCP_URL: "y" };
    expect(adoptLegacyEnv(env)).toEqual([]);
    expect(env).toEqual({ MY_T3CODE_HOME: "x", T3_MCP_URL: "y" });
  });
});

describe("legacyEnvWarning", () => {
  it("names each old variable and its replacement", () => {
    expect(legacyEnvWarning(["T3CODE_HOME"])).toContain("T3CODE_HOME -> LATHE_HOME");
  });

  it("says nothing when no old variable was set", () => {
    expect(legacyEnvWarning([])).toBeUndefined();
  });
});

describe("withLegacyExportedNames", () => {
  it("also exports each Lathe variable under its pre-rename name", () => {
    expect(withLegacyExportedNames({ LATHE_PROJECT_ROOT: "/repo", OTHER: "x" })).toEqual({
      LATHE_PROJECT_ROOT: "/repo",
      T3CODE_PROJECT_ROOT: "/repo",
      OTHER: "x",
    });
  });
});
