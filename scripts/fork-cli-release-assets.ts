#!/usr/bin/env node
/**
 * Fork-only. Prepares a release's CLI archives for upload: every
 * `lathe-<version>-<platform>` archive the builds produced is also published
 * as `t3-<version>-<platform>` for readers from before the rename, and
 * SHA256SUMS lists both names. See packages/shared/src/forkCliArtifacts.ts.
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off - streams release archives through sha256, which Effect Crypto does not do.
import * as NodeCrypto from "node:crypto";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";

import { CLI_ARCHIVE_PLATFORM_KEYS, CLI_RELEASE_CHECKSUMS_FILE } from "@t3tools/shared/cliRelease";
import { forkCliArchiveFileNames } from "@t3tools/shared/forkCliArtifacts";

export class ForkCliReleaseAssetsMissingError extends Schema.TaggedError<ForkCliReleaseAssetsMissingError>()(
  "ForkCliReleaseAssetsMissingError",
  { dir: Schema.String, version: Schema.String },
) {
  override get message(): string {
    return `${this.dir} holds no CLI archive for ${this.version}.`;
  }
}

export const writeForkCliReleaseAssets = Effect.fn("writeForkCliReleaseAssets")(function* (input: {
  readonly dir: string;
  readonly version: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const assets: string[] = [];
  for (const key of CLI_ARCHIVE_PLATFORM_KEYS) {
    const [built, ...aliases] = forkCliArchiveFileNames(input.version, key) as [
      string,
      ...string[],
    ];
    if (!(yield* fs.exists(path.join(input.dir, built)))) continue;
    for (const alias of aliases) {
      yield* fs.copyFile(path.join(input.dir, built), path.join(input.dir, alias));
    }
    assets.push(built, ...aliases);
  }
  if (assets.length === 0) {
    return yield* new ForkCliReleaseAssetsMissingError(input);
  }
  const lines: string[] = [];
  for (const asset of assets.sort()) {
    const hash = NodeCrypto.createHash("sha256");
    yield* fs
      .stream(path.join(input.dir, asset))
      .pipe(Stream.runForEach((chunk) => Effect.sync(() => hash.update(chunk))));
    lines.push(`${hash.digest("hex")}  ${asset}\n`);
  }
  yield* fs.writeFileString(path.join(input.dir, CLI_RELEASE_CHECKSUMS_FILE), lines.join(""));
  yield* Effect.log(`[cli-release-assets] ${CLI_RELEASE_CHECKSUMS_FILE}:\n${lines.join("")}`);
});

const command = Command.make(
  "fork-cli-release-assets",
  {
    dir: Flag.String("dir").pipe(Flag.withDescription("Directory holding the release assets.")),
    version: Flag.String("version").pipe(Flag.withDescription("Exact release version.")),
  },
  writeForkCliReleaseAssets,
).pipe(
  Command.withDescription(
    "Publish each CLI archive under its Lathe and pre-rename names and write SHA256SUMS.",
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
