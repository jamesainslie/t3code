import { describe, expect, it } from "vite-plus/test";

import {
  FORK_IDENTITY,
  forkDesktopIds,
  forkDesktopSchemes,
  forkPackageSpec,
} from "./forkIdentity.ts";

// Upstream's identity literals. The fork must differ from every one of them,
// or a fork build silently shares state, ports, or handlers with upstream.
const UPSTREAM = {
  npmPackageName: "t3",
  cliBin: "t3",
  baseDirName: ".t3",
  defaultPort: 3773,
  productBaseName: "T3 Code",
  appId: "com.t3tools.t3code",
  devAppId: "com.t3tools.t3code.dev",
  scheme: "t3code",
  devScheme: "t3code-dev",
  userDataDirName: "t3code",
  legacyUserDataDirName: "T3 Code (Alpha)",
  systemdName: "t3code",
  launchdLabel: "com.t3tools.t3code.service",
} as const;

describe("FORK_IDENTITY", () => {
  it("differs from upstream on every side-by-side collision point", () => {
    expect(FORK_IDENTITY.npmPackageName).not.toBe(UPSTREAM.npmPackageName);
    expect(FORK_IDENTITY.cliBin).not.toBe(UPSTREAM.cliBin);
    expect(FORK_IDENTITY.baseDirName).not.toBe(UPSTREAM.baseDirName);
    expect(FORK_IDENTITY.defaultPort).not.toBe(UPSTREAM.defaultPort);
    expect(FORK_IDENTITY.productBaseName).not.toBe(UPSTREAM.productBaseName);
    expect(FORK_IDENTITY.appId).not.toBe(UPSTREAM.appId);
    expect(FORK_IDENTITY.bootService.systemdName).not.toBe(UPSTREAM.systemdName);
    expect(FORK_IDENTITY.bootService.launchdLabel).not.toBe(UPSTREAM.launchdLabel);

    const production = FORK_IDENTITY.desktop.production;
    expect(production.appId).not.toBe(UPSTREAM.appId);
    expect(production.scheme).not.toBe(UPSTREAM.scheme);
    expect(production.userDataDirName).not.toBe(UPSTREAM.userDataDirName);
    expect(production.legacyUserDataDirName).not.toBe(UPSTREAM.legacyUserDataDirName);

    const development = FORK_IDENTITY.desktop.development;
    expect(development.appId).not.toBe(UPSTREAM.devAppId);
    expect(development.scheme).not.toBe(UPSTREAM.devScheme);
  });

  it("keeps derived values consistent with their base values", () => {
    expect(FORK_IDENTITY.desktop.production.appId).toBe(FORK_IDENTITY.appId);
    expect(FORK_IDENTITY.desktop.development.appId).toBe(`${FORK_IDENTITY.appId}.dev`);
    expect(FORK_IDENTITY.desktop.development.scheme).toBe(
      `${FORK_IDENTITY.desktop.production.scheme}-dev`,
    );
    expect(FORK_IDENTITY.bootService.launchdLabel).toBe(`${FORK_IDENTITY.appId}.service`);
    expect(FORK_IDENTITY.installedBinRelativePath).toBe(
      `node_modules/${FORK_IDENTITY.npmPackageName}/dist/bin.mjs`,
    );
    expect(FORK_IDENTITY.releasesUrl).toBe(`${FORK_IDENTITY.repositoryUrl}/releases`);
    expect(FORK_IDENTITY.desktop.production.desktopEntryName).toBe(
      `${FORK_IDENTITY.desktop.production.wmClass}.desktop`,
    );
  });

  it("uses a base directory name that stays hidden and a usable port", () => {
    expect(FORK_IDENTITY.baseDirName.startsWith(".")).toBe(true);
    expect(FORK_IDENTITY.defaultPort).toBeGreaterThanOrEqual(1024);
    expect(FORK_IDENTITY.defaultPort).toBeLessThanOrEqual(65535);
  });
});

describe("forkDesktopIds", () => {
  it("selects the development or production identifiers", () => {
    expect(forkDesktopIds(true)).toBe(FORK_IDENTITY.desktop.development);
    expect(forkDesktopIds(false)).toBe(FORK_IDENTITY.desktop.production);
  });
});

describe("forkPackageSpec", () => {
  it.each([
    ["nightly", "@jamesainslie/t3code@nightly"],
    ["latest", "@jamesainslie/t3code@latest"],
    ["0.0.39-nightly.20260906.12", "@jamesainslie/t3code@0.0.39-nightly.20260906.12"],
  ])("renders %s as %s", (input, expected) => {
    expect(forkPackageSpec(input)).toBe(expected);
  });
});

describe("forkDesktopSchemes", () => {
  it("lists production first, then development, with no upstream scheme", () => {
    expect(forkDesktopSchemes).toEqual([
      FORK_IDENTITY.desktop.production.scheme,
      FORK_IDENTITY.desktop.development.scheme,
    ]);
    expect(forkDesktopSchemes).not.toContain(UPSTREAM.scheme);
    expect(forkDesktopSchemes).not.toContain(UPSTREAM.devScheme);
  });
});
