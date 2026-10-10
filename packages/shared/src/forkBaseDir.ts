// @effect-diagnostics nodeBuiltinImport:off - synchronous so every resolver can swap one line.
/**
 * Fork-only. The fork's base directory was `.t3f` before the Lathe rename and
 * is `.lathe` after it. An existing `.t3f` stays in use where it is, because
 * running servers, SSH-launched remote servers, pinned runtimes and the `t3f`
 * launcher symlink all point into it; moving it from under them would strand
 * them. Moving `.t3f` to `.lathe` by hand, with nothing running, completes the
 * rename, and this then picks `.lathe`.
 *
 * Node only: the web bundle must not import this module.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { FORK_IDENTITY } from "./forkIdentity.ts";

/** The base directory name to use under `parent` (a home directory or worktree). */
export const forkBaseDirName = (parent: string): string =>
  !NodeFS.existsSync(NodePath.join(parent, FORK_IDENTITY.baseDirName)) &&
  NodeFS.existsSync(NodePath.join(parent, FORK_IDENTITY.legacyBaseDirName))
    ? FORK_IDENTITY.legacyBaseDirName
    : FORK_IDENTITY.baseDirName;

/**
 * The same rule as a POSIX shell expression for `$HOME`, for scripts that
 * resolve the base directory on another host (SSH remotes, WSL distros). It
 * expands to the directory's absolute path. Evaluate it inside double quotes,
 * and before anything creates `$HOME/.lathe`, or a pre-rename `.t3f` loses.
 */
export const FORK_HOME_SHELL = `$(if [ ! -e "$HOME/${FORK_IDENTITY.baseDirName}" ] && [ -d "$HOME/${FORK_IDENTITY.legacyBaseDirName}" ]; then printf %s "$HOME/${FORK_IDENTITY.legacyBaseDirName}"; else printf %s "$HOME/${FORK_IDENTITY.baseDirName}"; fi)`;
