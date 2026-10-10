/**
 * Fork-only. The names the self-contained CLI is published and installed
 * under. Upstream calls the executable `t3` and its release archives
 * `t3-<version>-<platform>-<arch>`; the fork's executable is `lathe`
 * (`FORK_IDENTITY.cliBin`).
 *
 * Machines and remote hosts that run an older release keep fetching
 * `t3-<version>-...` archives and running `<runtime>/t3`, including for
 * releases published after the rename: older CLIs running `update`, older
 * desktops' SSH runners, and older servers' remote self-update. So the move
 * happens in two phases, and this module holds both names until the second.
 *
 * Phase 1 (now), readers first:
 *   - Every archive holds the executable as `lathe` and as `t3` (a relative
 *     symlink in tar.gz, a copy in zip; scripts/lib/forkCliArchive.ts), and the
 *     top-level directory inside keeps upstream's `t3-<version>-<platform>`
 *     stem, which pre-rename install.ps1 copies look up by name.
 *   - Each release publishes the same bytes as `lathe-...` and `t3-...`, both
 *     in SHA256SUMS (scripts/fork-cli-release-assets.ts).
 *   - Readers download whichever name SHA256SUMS lists, `lathe-` first, and
 *     run `<dir>/lathe`, falling back to `<dir>/t3` for runtimes unpacked
 *     before the rename.
 *   - The npm launcher is `bin/lathe.js`; installs from before the rename have
 *     `bin/t3.js` and are still recognised. Platform packages carry only
 *     `lathe`: their only readers are the launcher published with them at the
 *     same exact version, and the registry refuses the archive's symlink.
 *   - The Windows desktop's WSL runtime runs `lathe` with no fallback: its
 *     archive is bundled by the same build and its cache is keyed by that
 *     archive's digest, so no older tree is ever selected.
 *
 * Phase 2 checklist (a later release, once every machine and remote host runs a
 * phase 1 release or newer, so nothing fetches `t3-*` or runs `<new runtime>/t3`):
 *   - Writers: stop writing the `t3` alias (scripts/lib/forkCliArchive.ts) and
 *     the `t3-*` asset copies (scripts/fork-cli-release-assets.ts, and the
 *     comment on its step in .github/workflows/release-fork.yml).
 *   - Asset names: drop `LEGACY_CLI_NAME` from `forkCliArchiveFileNames` and
 *     `forkCliArchiveShell`, and the `t3` candidate from the loops in
 *     scripts/install.sh and scripts/install.ps1. Releases from before phase 1
 *     then install only through an older installer or npm.
 *   - Stem: rename it to `lathe-<version>-<platform>` (`cliArchiveStem` in
 *     scripts/build-cli-archive.ts, `wslRuntimeArchiveStem` in
 *     scripts/build-desktop-artifact.ts), and first make install.ps1 move the
 *     archive's single top-level directory instead of looking up `$stem`.
 *   - npm: drop `bin/t3.js` from `FORK_NPM_LAUNCHER_SCRIPTS` (detection in
 *     apps/server/src/cli/invocation.ts) once no pre-rename global install can
 *     still be the running process.
 *   - Executables: keep the `t3` fallback in `forkCliExecutableNames` and both
 *     installers' executable pickers for as long as a `runtime/versions/<v>`
 *     unpacked before phase 1 can still start (service rollback, an existing
 *     boot unit, `update --allow-downgrade`, a remote's cached runtime). It
 *     costs one existence check; drop it last, or never.
 *   - Then delete whatever no longer has a second name to choose from here.
 *
 * Dependency-free so every runtime (server, desktop, scripts, mobile through
 * cliRelease) can import it.
 */
import { FORK_IDENTITY } from "./forkIdentity.ts";

/** Upstream's executable name and archive prefix. Phase 2 removes it. */
const LEGACY_CLI_NAME = "t3";

/** Executable base names, the one to run first. */
const CLI_NAMES = [FORK_IDENTITY.cliBin, LEGACY_CLI_NAME] as const;

/** The executable's file names in a runtime directory, the one to run first. */
export const forkCliExecutableNames = (platform: string): ReadonlyArray<string> =>
  CLI_NAMES.map((name) => (platform === "win32" ? `${name}.exe` : name));

/**
 * The executable to run in `dir`: the first name that exists, or the Lathe
 * name when the directory holds neither yet.
 */
export const forkCliExecutablePath = (
  dir: string,
  platform: string,
  join: (dir: string, name: string) => string,
  exists: (path: string) => boolean,
): string => {
  const candidates = forkCliExecutableNames(platform).map((name) => join(dir, name));
  return candidates.find((candidate) => exists(candidate)) ?? (candidates[0] as string);
};

/** Release asset names of one archive, the one to download first. */
export const forkCliArchiveFileNames = (
  version: string,
  platformKey: string,
): ReadonlyArray<string> => {
  const suffix = `${version}-${platformKey}.${platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
  return CLI_NAMES.map((name) => `${name}-${suffix}`);
};

/**
 * The archive to download from a release, judged by its checksum file: the
 * first name it lists, or the Lathe name when it lists neither (the caller
 * then reports that name as missing).
 */
export const forkCliArchiveFileNameIn = (
  checksums: ReadonlyMap<string, string>,
  version: string,
  platformKey: string,
): string => {
  const candidates = forkCliArchiveFileNames(version, platformKey);
  return candidates.find((name) => checksums.has(name)) ?? (candidates[0] as string);
};

/** The npm launcher's bin script, the one the fork publishes first. */
export const FORK_NPM_LAUNCHER_SCRIPTS = CLI_NAMES.map((name) => `bin/${name}.js`);

/**
 * `forkCliExecutablePath` as a POSIX shell expression for a non-Windows
 * runtime directory `dir` (a shell word such as `$T3_RUNTIME_DIR`). Expands to
 * `<dir>/lathe` when that is executable, otherwise `<dir>/t3`. Evaluate it
 * inside double quotes.
 */
export const forkCliExecutableShell = (dir: string): string =>
  `$(if [ -x "${dir}/${FORK_IDENTITY.cliBin}" ]; then printf %s "${dir}/${FORK_IDENTITY.cliBin}"; else printf %s "${dir}/${LEGACY_CLI_NAME}"; fi)`;

/**
 * `forkCliArchiveFileNameIn` as a POSIX shell expression. `checksumsFile` is
 * the downloaded SHA256SUMS and `suffix` the asset name after its prefix, for
 * example `$VERSION-$PLATFORM-$ARCH.tar.gz`; both are shell words. Evaluate it
 * inside double quotes.
 */
export const forkCliArchiveShell = (checksumsFile: string, suffix: string): string =>
  `$(for name in ${CLI_NAMES.join(" ")}; do if grep -q " \\*\\{0,1\\}$name-${suffix}$" "${checksumsFile}"; then printf %s "$name-${suffix}"; exit 0; fi; done; printf %s "${FORK_IDENTITY.cliBin}-${suffix}")`;

/**
 * A JavaScript expression for the npm launchers, which run as plain scripts
 * with `join` and `existsSync` in scope: the executable to run in the
 * directory `dir` evaluates to.
 */
export const forkCliExecutableJs = (dir: string): string =>
  `${JSON.stringify(CLI_NAMES)}.map((name) => join(${dir}, process.platform === "win32" ? name + ".exe" : name)).find((candidate) => existsSync(candidate)) ?? join(${dir}, ${JSON.stringify(FORK_IDENTITY.cliBin)} + (process.platform === "win32" ? ".exe" : ""))`;
