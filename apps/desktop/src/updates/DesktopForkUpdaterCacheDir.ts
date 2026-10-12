import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

const CACHE_DIR_LINE = /^updaterCacheDirName:.*$/m;

/** The bundled app-update.yml with electron-updater's cache directory set to `dirName`. */
export function withForkUpdaterCacheDir(raw: string, dirName: string): string {
  const line = `updaterCacheDirName: ${dirName}`;
  return CACHE_DIR_LINE.test(raw)
    ? raw.replace(CACHE_DIR_LINE, line)
    : `${raw.replace(/\n*$/, "\n")}${line}\n`;
}

/**
 * Fork-only. electron-builder writes `updaterCacheDirName` from the bundled
 * package.json name, which stays `t3code` because it names the keychain item,
 * and offers no override. Lathe and upstream T3 Code therefore shared one
 * download cache and replaced each other's pending updates. This points the
 * updater at a copy of the bundled feed with Lathe's own cache directory. An
 * app without a bundled feed (dev, preview builds) is left alone.
 */
export const applyForkUpdaterCacheDir = Effect.fn("desktop.updates.applyForkUpdaterCacheDir")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly appUpdateYmlPath: string;
    readonly overridePath: string;
    readonly setUpdateConfigPath: (configPath: string) => Effect.Effect<void>;
  }) {
    const bundled = yield* input.fileSystem
      .readFileString(input.appUpdateYmlPath)
      .pipe(Effect.option);
    if (bundled._tag === "None") return;

    yield* input.fileSystem.makeDirectory(input.path.dirname(input.overridePath), {
      recursive: true,
    });
    yield* input.fileSystem.writeFileString(
      input.overridePath,
      withForkUpdaterCacheDir(bundled.value, FORK_IDENTITY.updaterCacheDirName),
    );
    yield* input.setUpdateConfigPath(input.overridePath);
  },
  // Without the override the updater still works, on the shared cache.
  (effect) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not give the updater its own cache directory.", { error }),
      ),
    ),
);
