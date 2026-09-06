/**
 * Fork identity: every value that must differ from upstream `pingdotgg/t3code`
 * so this fork (`jamesainslie/t3code`) can be installed and run beside the
 * upstream nightly on the same machine.
 *
 * Fork-only module. Upstream files consume it through a single import and a
 * one-line literal swap so that merges from upstream stay mechanical. Keep it
 * dependency-free: the web bundle imports it too.
 */
export const FORK_IDENTITY = Object.freeze({
  npmPackageName: "@jamesainslie/t3code",
  cliBin: "t3f",
  installedBinRelativePath: "node_modules/@jamesainslie/t3code/dist/bin.mjs",
  baseDirName: ".t3f",
  defaultPort: 4773,
  productBaseName: "T3 Code Fork",
  artifactBaseName: "T3-Code-Fork",
  appId: "us.ainslies.t3code",
  repositoryUrl: "https://github.com/jamesainslie/t3code",
  releasesUrl: "https://github.com/jamesainslie/t3code/releases",
  urlHandlerDesktopEntryName: "t3code-fork-url-handler.desktop",
  bootService: Object.freeze({
    systemdName: "t3code-fork",
    launchdLabel: "us.ainslies.t3code.service",
  }),
  desktop: Object.freeze({
    production: Object.freeze({
      appId: "us.ainslies.t3code",
      scheme: "t3code-fork",
      executableName: "t3code-fork",
      userDataDirName: "t3code-fork",
      legacyUserDataDirName: "T3 Code Fork (Alpha)",
      desktopEntryName: "t3code-fork.desktop",
      wmClass: "t3code-fork",
    }),
    development: Object.freeze({
      appId: "us.ainslies.t3code.dev",
      scheme: "t3code-fork-dev",
      executableName: "t3code-fork-dev",
      userDataDirName: "t3code-fork-dev",
      legacyUserDataDirName: "T3 Code Fork (Dev)",
      desktopEntryName: "t3code-fork-dev.desktop",
      wmClass: "t3code-fork-dev",
    }),
  }),
} as const);

/** Widened shape shared by the production and development desktop identifiers. */
export type ForkDesktopIds = Readonly<
  Record<keyof typeof FORK_IDENTITY.desktop.production, string>
>;

/** Desktop identifiers for the running environment (dev builds get `-dev` variants). */
export const forkDesktopIds = (isDevelopment: boolean): ForkDesktopIds =>
  isDevelopment ? FORK_IDENTITY.desktop.development : FORK_IDENTITY.desktop.production;

/** `@jamesainslie/t3code@<version or dist-tag>` for npm and npx invocations. */
export const forkPackageSpec = (versionOrTag: string): string =>
  `${FORK_IDENTITY.npmPackageName}@${versionOrTag}`;

/** Every URL scheme the fork desktop registers, production first. */
export const forkDesktopSchemes = [
  FORK_IDENTITY.desktop.production.scheme,
  FORK_IDENTITY.desktop.development.scheme,
] as const;
