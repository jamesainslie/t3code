/**
 * Fork-only. Writes the executable into a CLI archive under both of its
 * names; see packages/shared/src/forkCliArtifacts.ts for the transition the
 * second name serves and when it goes away.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { forkCliArchiveFileNames, forkCliExecutableNames } from "@t3tools/shared/forkCliArtifacts";

type ArchivePlatform = "mac" | "linux" | "win";

/**
 * The file name a build writes an archive under: `lathe-<version>-<platformKey>`.
 * The release adds the pre-rename name (scripts/fork-cli-release-assets.ts).
 */
export const forkArchiveFileName = (version: string, platformKey: string): string =>
  forkCliArchiveFileNames(version, platformKey)[0] as string;

const executableNames = (platform: ArchivePlatform) =>
  forkCliExecutableNames(platform === "win" ? "win32" : platform);

/** The executable's real file name inside an archive: `lathe` or `lathe.exe`. */
export const forkArchiveExecutableName = (platform: ArchivePlatform): string =>
  executableNames(platform)[0] as string;

/**
 * Adds `t3` beside the signed `lathe` in a staged archive directory, so
 * readers from before the rename still find the executable they run.
 *
 * tar.gz gets a relative symlink: every reader unpacks with tar, which keeps
 * it, and it costs nothing, where a hard link becomes a second full copy
 * under the `--hard-dereference` the Linux build packs with. The npm platform
 * packages drop it, since the registry refuses links. A zip holds no links,
 * so Windows gets a copy of the already signed executable.
 */
export const writeForkCliExecutableAlias = Effect.fn("writeForkCliExecutableAlias")(function* (
  contentDir: string,
  platform: ArchivePlatform,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const [executable, ...aliases] = executableNames(platform) as [string, ...string[]];
  for (const alias of aliases) {
    const aliasPath = path.join(contentDir, alias);
    yield* fs.remove(aliasPath, { force: true });
    if (platform === "win") {
      yield* fs.copyFile(path.join(contentDir, executable), aliasPath);
    } else {
      yield* fs.symlink(executable, aliasPath);
    }
  }
});
