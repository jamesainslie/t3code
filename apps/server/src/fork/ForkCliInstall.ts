/**
 * Fork-only names the CLI uses to find what the fork's installers put on disk.
 */
import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";

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
