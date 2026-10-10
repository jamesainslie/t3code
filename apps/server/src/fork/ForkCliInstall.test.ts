import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { findWindowsShim } from "../cli/update.ts";
import { isForkBootServiceCgroup } from "./ForkCliInstall.ts";

it.layer(NodeServices.layer)("fork CLI install", (it) => {
  // The installer writes `lathe.cmd`; installs from before the rename wrote `t3f.cmd`.
  it.effect.each(["lathe.cmd", "t3f.cmd"])(
    "finds the %s shim that launches the running executable",
    (shimName) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-cli-shim-" });
        const executable = path.join(root, "runtime/versions/1.0.0/t3.exe");
        const shim = path.join(root, "bin", shimName);
        yield* fs.makeDirectory(path.dirname(shim), { recursive: true });
        yield* fs.writeFileString(shim, `@echo off\r\n"${executable}" %*`);

        const found = yield* findWindowsShim(executable).pipe(
          Effect.provideService(HostProcess.Environment, {
            T3CODE_INSTALL_BIN_DIR: path.join(root, "bin"),
          }),
        );

        assert.equal(found, shim);
      }).pipe(Effect.scoped),
  );
});

it("recognises a process running in the fork's systemd user unit", () => {
  const inUnit = (unit: string) =>
    `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}\n`;

  assert.isTrue(isForkBootServiceCgroup(inUnit("t3code-fork.service")));
  // Upstream's unit belongs to an upstream install running beside the fork.
  assert.isFalse(isForkBootServiceCgroup(inUnit("t3code.service")));
  assert.isFalse(isForkBootServiceCgroup("0::/user.slice/user-1000.slice/session-2.scope\n"));
});
