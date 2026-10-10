import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import {
  forkArchiveExecutableName,
  forkArchiveFileName,
  writeForkCliExecutableAlias,
} from "./forkCliArchive.ts";

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const run = Effect.fn("test.run")(function* (command: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(command, args));
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode };
});

const windowsHost = HostProcessPlatform.defaultValue() === "win32";

it.layer(NodeServices.layer)("writeForkCliExecutableAlias", (it) => {
  it("names the archive executable lathe", () => {
    assert.equal(forkArchiveExecutableName("mac"), "lathe");
    assert.equal(forkArchiveExecutableName("linux"), "lathe");
    assert.equal(forkArchiveExecutableName("win"), "lathe.exe");
  });

  it("writes the archive under its Lathe name", () => {
    assert.equal(forkArchiveFileName("1.2.3", "linux-arm64"), "lathe-1.2.3-linux-arm64.tar.gz");
    assert.equal(forkArchiveFileName("1.2.3", "win32-x64"), "lathe-1.2.3-win32-x64.zip");
  });

  // Packed and unpacked the way build-cli-archive.ts and every installer do,
  // so the alias is proven to survive the round trip older readers make.
  it.effect.skipIf(windowsHost)(
    "packs t3 as a relative symlink to lathe that runs after --strip-components",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-cli-archive-" });
        const stem = "t3-1.2.3-linux-x64";
        const contentDir = path.join(root, "stage", stem);
        yield* fs.makeDirectory(contentDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(contentDir, "lathe"),
          "#!/bin/sh\necho lathe v1.2.3\n",
          { mode: 0o755 },
        );

        yield* writeForkCliExecutableAlias(contentDir, "linux");

        assert.equal(yield* fs.readLink(path.join(contentDir, "t3")), "lathe");
        const archive = path.join(root, `${stem}.tar.gz`);
        const pack = yield* run("tar", ["-czf", archive, "-C", path.join(root, "stage"), stem]);
        assert.equal(pack.exitCode, 0, pack.stderr);
        const listing = yield* run("tar", ["-tzvf", archive]);
        assert.match(listing.stdout, /^l.* t3-1\.2\.3-linux-x64\/t3 -> lathe$/m);
        assert.match(listing.stdout, /^-rwx.* t3-1\.2\.3-linux-x64\/lathe$/m);

        const runtime = path.join(root, "runtime");
        yield* fs.makeDirectory(runtime);
        const unpack = yield* run("tar", ["-xzf", archive, "-C", runtime, "--strip-components=1"]);
        assert.equal(unpack.exitCode, 0, unpack.stderr);
        for (const name of ["lathe", "t3"]) {
          const version = yield* run(path.join(runtime, name), []);
          assert.equal(version.stdout.trim(), "lathe v1.2.3", name);
        }
      }),
  );

  it.effect("copies lathe.exe to t3.exe, since a zip holds no links", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const contentDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-cli-archive-win-" });
      yield* fs.writeFileString(path.join(contentDir, "lathe.exe"), "MZ signed bytes");

      yield* writeForkCliExecutableAlias(contentDir, "win");

      const alias = path.join(contentDir, "t3.exe");
      // readLink fails on a regular file.
      yield* fs.readLink(alias).pipe(Effect.flip);
      assert.equal(yield* fs.readFileString(alias), "MZ signed bytes");
    }),
  );
});
