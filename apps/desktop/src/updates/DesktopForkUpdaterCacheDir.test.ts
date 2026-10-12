import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { applyForkUpdaterCacheDir, withForkUpdaterCacheDir } from "./DesktopForkUpdaterCacheDir.ts";

const BUNDLED = [
  "owner: jamesainslie",
  "repo: t3code",
  "provider: github",
  "releaseType: prerelease",
  "channel: nightly",
  "updaterCacheDirName: t3code-updater",
  "",
].join("\n");

describe("withForkUpdaterCacheDir", () => {
  it("renames the cache directory and keeps the rest of the feed", () => {
    const rewritten = withForkUpdaterCacheDir(BUNDLED, "lathe-updater");
    assert.include(rewritten, "updaterCacheDirName: lathe-updater\n");
    assert.notInclude(rewritten, "t3code-updater");
    assert.include(rewritten, "owner: jamesainslie\nrepo: t3code\nprovider: github\n");
  });

  it("adds the cache directory when the feed has none", () => {
    const rewritten = withForkUpdaterCacheDir(
      "provider: github\nowner: jamesainslie",
      "lathe-updater",
    );
    assert.strictEqual(
      rewritten,
      "provider: github\nowner: jamesainslie\nupdaterCacheDirName: lathe-updater\n",
    );
  });
});

describe("applyForkUpdaterCacheDir", () => {
  it.effect("points the updater at a copy of the feed with Lathe's cache directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lathe-updater-" });
      const appUpdateYmlPath = path.join(dir, "app-update.yml");
      const overridePath = path.join(dir, "state", "lathe-app-update.yml");
      yield* fileSystem.writeFileString(appUpdateYmlPath, BUNDLED);
      const configPaths: Array<string> = [];

      yield* applyForkUpdaterCacheDir({
        fileSystem,
        path,
        appUpdateYmlPath,
        overridePath,
        setUpdateConfigPath: (configPath) =>
          Effect.sync(() => {
            configPaths.push(configPath);
          }),
      });

      assert.deepStrictEqual(configPaths, [overridePath]);
      const written = yield* fileSystem.readFileString(overridePath);
      assert.include(written, "updaterCacheDirName: lathe-updater\n");
      assert.include(written, "owner: jamesainslie\n");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves the updater alone when the app ships no feed", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lathe-updater-" });
      const configPaths: Array<string> = [];

      yield* applyForkUpdaterCacheDir({
        fileSystem,
        path,
        appUpdateYmlPath: path.join(dir, "app-update.yml"),
        overridePath: path.join(dir, "lathe-app-update.yml"),
        setUpdateConfigPath: (configPath) =>
          Effect.sync(() => {
            configPaths.push(configPath);
          }),
      });

      assert.deepStrictEqual(configPaths, []);
      assert.isFalse(yield* fileSystem.exists(path.join(dir, "lathe-app-update.yml")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
