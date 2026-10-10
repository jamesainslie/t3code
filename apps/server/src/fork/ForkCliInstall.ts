// @effect-diagnostics nodeBuiltinImport:off - synchronous so pinnedRuntimePaths can swap one line.
/**
 * Fork-only names the CLI uses to find what the fork's installers put on disk.
 */
import * as NodeFS from "node:fs";

import { forkCliExecutablePath } from "@t3tools/shared/forkCliArtifacts";
import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";

/**
 * The executable of the pinned runtime unpacked in `versionDir`: `lathe`, or
 * `t3` in a runtime unpacked from a release before the Lathe rename. See
 * packages/shared/src/forkCliArtifacts.ts.
 */
export const forkRuntimeExecutablePath = (
  join: (dir: string, name: string) => string,
  versionDir: string,
  platform: NodeJS.Platform,
): string => forkCliExecutablePath(versionDir, platform, join, NodeFS.existsSync);

/**
 * Windows `.cmd` launchers the fork's install.ps1 writes, newest first: `lathe.cmd`
 * now, `t3f.cmd` from before the Lathe rename.
 */
const FORK_WINDOWS_SHIM_NAMES = [`${FORK_IDENTITY.cliBin}.cmd`, "t3f.cmd"] as const;

/** Every candidate shim path in `directories`, in PATH order. */
export const forkWindowsShimPaths = (
  directories: ReadonlyArray<string>,
  join: (directory: string, name: string) => string,
): ReadonlyArray<string> =>
  directories.flatMap((directory) => FORK_WINDOWS_SHIM_NAMES.map((name) => join(directory, name)));

/**
 * Whether a `/proc/<pid>/cgroup` listing puts the process inside the fork's
 * systemd user unit, which keeps its pre-rename name `t3code-fork.service`.
 */
export const isForkBootServiceCgroup = (cgroup: string): boolean =>
  cgroup.includes(`/${FORK_IDENTITY.bootService.systemdName}.service`);
