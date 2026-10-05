import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";

import { resolveUserDataPath } from "./DesktopUserData.ts";

// Fork: one profile serves every release, beside upstream's `t3code` and `t3code-v2`.
const { production, development } = FORK_IDENTITY.desktop;

it.effect.each([
  { platform: "darwin" as const, isDevelopment: false, ids: production },
  { platform: "win32" as const, isDevelopment: false, ids: production },
  { platform: "linux" as const, isDevelopment: true, ids: development },
])("uses the fork profile on $platform when no legacy profile exists", (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-profile-" });
    // Upstream's profiles on the same machine are never read or copied.
    yield* fs.makeDirectory(path.join(directory, "t3code-v2"), { recursive: true });
    yield* fs.writeFileString(path.join(directory, "t3code-v2", "Local State"), "upstream");
    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: input.isDevelopment,
      platform: input.platform,
    });
    assert.equal(resolved, path.join(directory, input.ids.userDataDirName));
    assert.isFalse(yield* fs.exists(path.join(resolved, "Local State")));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect.each([
  { isDevelopment: false, ids: production },
  { isDevelopment: true, ids: development },
])("keeps an existing legacy profile (development: $isDevelopment)", (input) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-profile-" });
    const legacy = path.join(directory, input.ids.legacyUserDataDirName);
    yield* fs.makeDirectory(legacy, { recursive: true });
    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: input.isDevelopment,
      platform: "win32",
    });
    assert.equal(resolved, legacy);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("preserves the cause when the profile cannot be inspected", () => {
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "exists",
    pathOrDescriptor: "/profiles",
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "darwin",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "inspect");
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({ exists: () => Effect.fail(cause) }),
    ),
    Effect.provide(NodeServices.layer),
  );
});
