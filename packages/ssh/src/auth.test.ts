import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HostProcess from "@lathe/shared/HostProcess";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  isSshAuthFailure,
} from "./auth.ts";

describe("ssh auth", () => {
  it.effect("detects ssh auth failures from common permission denied messages", () =>
    Effect.sync(() => {
      assert.equal(
        isSshAuthFailure(
          new Error(
            "julius@100.65.180.100: Permission denied (publickey,password,keyboard-interactive).",
          ),
        ),
        true,
      );
      assert.equal(isSshAuthFailure(new Error("Permission denied (publickey).")), true);
      assert.equal(isSshAuthFailure(new Error("Connection timed out")), false);
      assert.equal(isSshAuthFailure(new Error("mkdir: Permission denied")), false);
    }),
  );

  it.effect("creates askpass env for cached password prompts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-ssh-askpass-test-" });
      const env = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        baseEnv: {},
      });

      const askpassPath = path.join(directory, "ssh-askpass.sh");
      assert.equal(env.SSH_ASKPASS, askpassPath);
      assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
      assert.equal(env.LATHE_SSH_AUTH_SECRET, "super-secret");
      assert.equal(env.DISPLAY, "lathe");
      assert.equal(yield* fs.exists(askpassPath), true);
      assert.include(
        yield* fs.readFileString(askpassPath),
        'printf "%s\\n" "$LATHE_SSH_AUTH_SECRET"',
      );
    }).pipe(
      Effect.provide(Layer.merge(NodeServices.layer, Layer.succeed(HostProcess.Platform, "linux"))),
      Effect.scoped,
    ),
  );

  // A long-lived ssh keeps its environment until it exits, so the secret goes in
  // a file the caller deletes once authentication is done.
  it.live.skipIf(HostProcess.Platform.defaultValue() === "win32")(
    "can hand the askpass helper its secret through a private file",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-ssh-askpass-test-" });
        const env = yield* buildSshChildEnvironment({
          authSecret: "super-secret",
          authSecretDelivery: "file",
          interactiveAuth: true,
          askpassDirectory: directory,
          baseEnv: {},
        });

        assert.isUndefined(env.LATHE_SSH_AUTH_SECRET);
        const secretFile = env.LATHE_SSH_AUTH_SECRET_FILE;
        assert.isDefined(secretFile);
        if (secretFile === undefined || env.SSH_ASKPASS === undefined) return;
        assert.equal((yield* fs.stat(secretFile)).mode & 0o777, 0o600);

        const askpass = (childEnv: Record<string, string | undefined>) =>
          Effect.gen(function* () {
            const child = yield* spawner.spawn(
              ChildProcess.make(env.SSH_ASKPASS ?? "", [], { env: childEnv, extendEnv: false }),
            );
            const [stdout, exitCode] = yield* Effect.all(
              [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
              { concurrency: "unbounded" },
            );
            return { stdout, exitCode: Number(exitCode) };
          }).pipe(Effect.scoped);

        assert.deepEqual(
          yield* askpass({ PATH: "/usr/bin:/bin", LATHE_SSH_AUTH_SECRET_FILE: secretFile }),
          { stdout: "super-secret\n", exitCode: 0 },
        );
        yield* fs.remove(secretFile);
        assert.notEqual(
          (yield* askpass({ PATH: "/usr/bin:/bin", LATHE_SSH_AUTH_SECRET_FILE: secretFile }))
            .exitCode,
          0,
        );
      }).pipe(
        Effect.provide(
          Layer.merge(NodeServices.layer, Layer.succeed(HostProcess.Platform, "linux")),
        ),
        Effect.scoped,
      ),
  );

  it.effect("builds a windows askpass launcher pair", () =>
    Effect.gen(function* () {
      const descriptor = yield* buildSshAskpassHelperDescriptor({
        directory: "C:\\temp\\t3code-ssh-askpass",
      }).pipe(
        Effect.provide(
          Layer.merge(NodeServices.layer, Layer.succeed(HostProcess.Platform, "win32")),
        ),
      );

      assert.equal(descriptor.launcherPath, "C:\\temp\\t3code-ssh-askpass\\ssh-askpass.cmd");
      assert.deepEqual(
        descriptor.files.map((file) => file.path.split("\\").at(-1)),
        ["ssh-askpass.cmd", "ssh-askpass.ps1"],
      );
    }),
  );
});
