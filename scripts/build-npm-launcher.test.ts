// @effect-diagnostics nodeBuiltinImport:off - Serves a fake GitHub Release over real HTTP to the published launcher.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@lathe/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeHttp from "node:http";

import { FORK_IDENTITY } from "@lathe/shared/forkIdentity";

import { buildNpmLauncher } from "./build-npm-launcher.ts";

const VERSION = "1.2.3";
const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const run = Effect.fn("test.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly env: Record<string, string | undefined> },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, { cwd: options.cwd, env: options.env, extendEnv: false }),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [collect(child.stdout), collect(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  );
  return { stdout, stderr, exitCode };
}, Effect.scoped);

const STUB_EXECUTABLE = '#!/bin/sh\necho "stub $* launcher=$LATHE_NPM_LAUNCHER_PATH"\nexit 7\n';

/**
 * A release archive for this host with a stub executable that echoes its args
 * and launcher. Fork: a release after the Lathe rename lists `lathe-*` archives
 * holding `lathe`; one from before it lists `t3-*` holding `t3`.
 */
const serveFakeRelease = Effect.fn("test.serveFakeRelease")(function* (
  root: string,
  release: {
    readonly prefix: string;
    readonly files: Readonly<Record<string, string>>;
  } = { prefix: "lathe", files: { lathe: STUB_EXECUTABLE } },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const key = `${yield* HostProcess.Platform}-${yield* HostProcess.Architecture}`;
  const stem = `t3-${VERSION}-${key}`;
  const archiveName = `${release.prefix}-${VERSION}-${key}.tar.gz`;
  yield* fs.makeDirectory(path.join(root, "release", stem, "node_modules/native"), {
    recursive: true,
  });
  for (const [name, content] of Object.entries(release.files)) {
    yield* fs.writeFileString(path.join(root, "release", stem, name), content);
    yield* fs.chmod(path.join(root, "release", stem, name), 0o755);
  }
  const tar = yield* run("tar", ["-czf", archiveName, stem], {
    cwd: path.join(root, "release"),
    env: { PATH: process.env.PATH },
  });
  assert.equal(tar.exitCode, 0, tar.stderr);
  const archive = yield* fs.readFile(path.join(root, "release", archiveName));
  let checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
  const requests: Array<string> = [];
  const server = NodeHttp.createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === `/v${VERSION}/SHA256SUMS`) {
      response.end(`${checksum}  ${archiveName}\n`);
    } else if (request.url === `/v${VERSION}/${archiveName}`) {
      response.writeHead(200, { "Content-Length": archive.length }).end(archive);
    } else {
      response.writeHead(404).end();
    }
  });
  yield* Effect.acquireRelease(
    Effect.callback<void>((resume) => {
      server.listen(0, "127.0.0.1", () => resume(Effect.void));
    }),
    () =>
      Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") return yield* Effect.die("no TCP address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    corruptChecksum: () => {
      checksum = "0".repeat(64);
    },
  };
});

it.layer(NodeServices.layer)("build-npm-launcher", (it) => {
  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "publishes a launcher that downloads, verifies, caches, and runs the release executable",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-npm-launcher-test-" });
        const output = yield* buildNpmLauncher({
          version: VERSION,
          outputDir: path.join(root, "out"),
        });

        const manifest = yield* decodeManifest(
          yield* fs.readFileString(path.join(output.packageDir, "package.json")),
        );
        assert.equal(manifest.name, FORK_IDENTITY.npmPackageName);
        assert.equal(manifest.version, VERSION);
        assert.deepStrictEqual(manifest.bin, { lathe: "./bin/lathe.mjs" });
        // Nothing for npm to resolve, so nothing that can lag behind the launcher.
        assert.isUndefined(manifest.dependencies);
        assert.isUndefined(manifest.optionalDependencies);

        // Run what npm would install: the published tarball, unpacked.
        const installed = path.join(root, "installed");
        yield* fs.makeDirectory(installed);
        const unpack = yield* run("tar", ["-xzf", output.tarball, "-C", installed], {
          cwd: root,
          env: { PATH: process.env.PATH },
        });
        assert.equal(unpack.exitCode, 0, unpack.stderr);
        const packageDir = path.join(installed, "package");

        const release = yield* serveFakeRelease(root);
        const home = path.join(root, "home");
        const env = {
          PATH: process.env.PATH,
          LATHE_HOME: home,
          LATHE_RELEASE_BASE_URL: release.baseUrl,
        };
        const launcher = path.join(packageDir, "bin/lathe.mjs");
        const first = yield* run(process.execPath, [launcher, "serve", "a b"], {
          cwd: root,
          env,
        });
        assert.equal(first.stdout.trim(), `stub serve a b launcher=${launcher}`, first.stderr);
        assert.equal(first.exitCode, 7);
        // The same layout the install scripts and `t3 update` use.
        const versionDir = path.join(home, "runtime/versions", VERSION);
        assert.equal(
          (yield* fs.readFileString(path.join(versionDir, ".install-complete"))).trim(),
          VERSION,
        );
        assert.isTrue(yield* fs.exists(path.join(versionDir, "node_modules/native")));
        assert.deepStrictEqual(
          (yield* fs.readDirectory(path.join(home, "runtime/versions"))).sort(),
          [VERSION],
        );

        // A second run reuses the download.
        const requestsAfterFirst = release.requests.length;
        const second = yield* run(process.execPath, [launcher, "--version"], { cwd: root, env });
        assert.equal(second.exitCode, 7);
        assert.equal(release.requests.length, requestsAfterFirst);

        // Services installed before 0.0.41 fork dist/bin.mjs and talk to the
        // server over IPC; the channel and SIGTERM must reach the executable.
        const ipcServer = path.join(home, "runtime/versions", VERSION, "lathe");
        yield* fs.writeFileString(
          ipcServer,
          `#!${process.execPath}\nprocess.on("SIGTERM", () => process.exit(23));\nprocess.on("message", (m) => process.send({ reply: m }));\nprocess.send({ args: process.argv.slice(2) });\n`,
        );
        const legacy = NodeChildProcess.fork(
          path.join(packageDir, "dist/bin.mjs"),
          ["__service-preflight", "a b"],
          { env, silent: true },
        );
        yield* Effect.promise(async () => {
          assert.deepStrictEqual((await NodeEvents.EventEmitter.once(legacy, "message"))[0], {
            args: ["__service-preflight", "a b"],
          });
          const reply = NodeEvents.EventEmitter.once(legacy, "message");
          legacy.send({ type: "trial-accepted" });
          assert.deepStrictEqual((await reply)[0], { reply: { type: "trial-accepted" } });
          const exit = NodeEvents.EventEmitter.once(legacy, "exit");
          legacy.kill("SIGTERM");
          assert.deepStrictEqual(await exit, [23, null]);
        });

        // Two first runs at once both start, and neither removes the other's install.
        const raceHome = path.join(root, "race-home");
        const launch = run(process.execPath, [launcher, "--version"], {
          cwd: root,
          env: { ...env, LATHE_HOME: raceHome },
        });
        const [one, two] = yield* Effect.all([launch, launch], { concurrency: "unbounded" });
        assert.equal(one.exitCode, 7, one.stderr);
        assert.equal(two.exitCode, 7, two.stderr);
        assert.deepStrictEqual(yield* fs.readDirectory(path.join(raceHome, "runtime/versions")), [
          VERSION,
        ]);

        // A download that does not match the release checksums is never installed.
        release.corruptChecksum();
        const corrupt = yield* run(process.execPath, [launcher, "--version"], {
          cwd: root,
          env: { ...env, LATHE_HOME: path.join(root, "other-home") },
        });
        assert.equal(corrupt.exitCode, 1);
        assert.include(corrupt.stderr, "checksum mismatch");
        assert.deepStrictEqual(
          yield* fs.readDirectory(path.join(root, "other-home/runtime/versions")),
          [],
        );
      }),
  );

  it.effect("carries the fork identity the published script cannot import", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const source = yield* fs.readFileString(
        path.join(
          yield* path.fromFileUrl(new URL("./npm-launcher/", import.meta.url)),
          "lathe.mjs",
        ),
      );
      assert.include(
        source,
        `"https://github.com/${FORK_IDENTITY.releaseRepository}/releases/download"`,
      );
      assert.include(source, `"${FORK_IDENTITY.baseDirName}"`);
      assert.include(source, `"${FORK_IDENTITY.legacyBaseDirName}"`);
      assert.include(source, `const CLI_NAMES = ["${FORK_IDENTITY.cliBin}", "t3"];`);
      assert.notInclude(source, "pingdotgg");
    }),
  );

  /** Builds the launcher and unpacks it the way npm installs it; returns its bin script. */
  const installLauncher = Effect.fn("test.installLauncher")(function* (root: string) {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const output = yield* buildNpmLauncher({ version: VERSION, outputDir: path.join(root, "out") });
    const installed = path.join(root, "installed");
    yield* fs.makeDirectory(installed);
    const unpack = yield* run("tar", ["-xzf", output.tarball, "-C", installed], {
      cwd: root,
      env: { PATH: process.env.PATH },
    });
    assert.equal(unpack.exitCode, 0, unpack.stderr);
    return path.join(installed, "package/bin/lathe.mjs");
  });

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "installs and runs a release from before the Lathe rename",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-npm-launcher-test-" });
        const launcher = yield* installLauncher(root);
        const release = yield* serveFakeRelease(root, {
          prefix: "t3",
          files: { t3: STUB_EXECUTABLE },
        });
        const result = yield* run(process.execPath, [launcher, "serve"], {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            LATHE_HOME: path.join(root, "home"),
            LATHE_RELEASE_BASE_URL: release.baseUrl,
          },
        });
        assert.equal(result.stdout.trim(), `stub serve launcher=${launcher}`, result.stderr);
        assert.equal(result.exitCode, 7);
      }),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "runs the bundle with the host Node when the executable cannot start",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-npm-launcher-test-" });
        const launcher = yield* installLauncher(root);
        // An interpreter that does not exist fails exec with ENOENT, as a
        // glibc executable does on NixOS.
        const release = yield* serveFakeRelease(root, {
          prefix: "lathe",
          files: {
            lathe: "#!/nonexistent/interpreter\n",
            "bin.mjs":
              'console.log("bundle", process.argv.slice(2).join(" "));\nprocess.exit(9);\n',
          },
        });
        const result = yield* run(process.execPath, [launcher, "serve", "a b"], {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            LATHE_HOME: path.join(root, "home"),
            LATHE_RELEASE_BASE_URL: release.baseUrl,
          },
        });
        assert.equal(result.stdout.trim(), "bundle serve a b", result.stderr);
        assert.equal(result.exitCode, 9);
      }),
  );

  it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "keeps a pre-rename .t3f home in use and otherwise installs into .lathe",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-npm-launcher-test-" });
        const launcher = yield* installLauncher(root);
        const release = yield* serveFakeRelease(root);
        const launchWithHome = (home: string) =>
          run(process.execPath, [launcher, "--version"], {
            cwd: root,
            env: { PATH: process.env.PATH, HOME: home, LATHE_RELEASE_BASE_URL: release.baseUrl },
          });

        const fresh = path.join(root, "fresh");
        yield* fs.makeDirectory(fresh);
        assert.equal((yield* launchWithHome(fresh)).exitCode, 7);
        assert.isTrue(yield* fs.exists(path.join(fresh, ".lathe/runtime/versions", VERSION)));

        const legacy = path.join(root, "legacy");
        yield* fs.makeDirectory(path.join(legacy, ".t3f"), { recursive: true });
        assert.equal((yield* launchWithHome(legacy)).exitCode, 7);
        assert.isTrue(yield* fs.exists(path.join(legacy, ".t3f/runtime/versions", VERSION)));
        assert.isFalse(yield* fs.exists(path.join(legacy, ".lathe")));
      }),
  );
});
