import * as NodeCrypto from "node:crypto";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { parseChecksums } from "@t3tools/shared/cliRelease";

import {
  ForkCliReleaseAssetsMissingError,
  writeForkCliReleaseAssets,
} from "./fork-cli-release-assets.ts";

const VERSION = "1.2.3-nightly.20261009.1";
const sha256 = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

it.layer(NodeServices.layer)("writeForkCliReleaseAssets", (it) => {
  it.effect("publishes every archive under both names, each in SHA256SUMS", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-cli-release-assets-" });
      const linux = NodeCrypto.randomBytes(1024);
      const darwin = NodeCrypto.randomBytes(1024);
      yield* fs.writeFile(path.join(dir, `lathe-${VERSION}-linux-x64.tar.gz`), linux);
      yield* fs.writeFile(path.join(dir, `lathe-${VERSION}-darwin-arm64.tar.gz`), darwin);
      // Desktop artifacts share the directory and stay out of the checksums.
      yield* fs.writeFileString(path.join(dir, `Lathe-${VERSION}-arm64.dmg`), "dmg");

      yield* writeForkCliReleaseAssets({ dir, version: VERSION });

      for (const [key, bytes] of [
        ["linux-x64", linux],
        ["darwin-arm64", darwin],
      ] as const) {
        assert.deepEqual(
          yield* fs.readFile(path.join(dir, `t3-${VERSION}-${key}.tar.gz`)),
          new Uint8Array(bytes),
        );
      }
      const text = yield* fs.readFileString(path.join(dir, "SHA256SUMS"));
      assert.deepEqual(
        [...parseChecksums(text)].sort(([a], [b]) => a.localeCompare(b)),
        [
          [`lathe-${VERSION}-darwin-arm64.tar.gz`, sha256(darwin)],
          [`lathe-${VERSION}-linux-x64.tar.gz`, sha256(linux)],
          [`t3-${VERSION}-darwin-arm64.tar.gz`, sha256(darwin)],
          [`t3-${VERSION}-linux-x64.tar.gz`, sha256(linux)],
        ],
      );
      // sha256sum's own format, so `sha256sum -c` and every installer read it.
      for (const line of text.trimEnd().split("\n")) {
        assert.match(line, /^[0-9a-f]{64} {2}(lathe|t3)-\S+$/);
      }
    }),
  );

  it.effect("fails when the directory holds no CLI archive for the version", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-cli-release-assets-" });
      yield* fs.writeFileString(path.join(dir, "t3-0.0.1-linux-x64.tar.gz"), "other version");

      const error = yield* writeForkCliReleaseAssets({ dir, version: VERSION }).pipe(Effect.flip);

      assert.instanceOf(error, ForkCliReleaseAssetsMissingError);
      assert.isFalse(yield* fs.exists(path.join(dir, "SHA256SUMS")));
    }),
  );
});
