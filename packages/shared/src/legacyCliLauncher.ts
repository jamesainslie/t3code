/**
 * `dist/bin.mjs` of the `t3` npm package: the entry point boot-service
 * launchers installed before 0.0.41 run with Node to start a new version they
 * just npm-installed. It forwards everything (arguments, stdio, the IPC
 * channel the launcher talks over, signals, exit status) to the platform
 * executable in the sibling `@t3code/t3-<platform>-<arch>` package.
 *
 * The first server started this way rewrites the service unit to run the
 * executable directly, so nothing depends on this file after one update.
 * Remove it once no supported release predates the executable (after the
 * first stable release that ships it).
 */
import { FORK_IDENTITY } from "./forkIdentity.ts";

export function legacyCliLauncherScript(): string {
  return `import { spawn } from "node:child_process";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const executableName = process.platform === "win32" ? "t3.exe" : "t3";
const packageDir = dirname(require.resolve("${FORK_IDENTITY.npm.platformPackageScope}/${FORK_IDENTITY.npm.platformPackagePrefix}" + process.platform + "-" + process.arch + "/package.json"));
const executable = join(packageDir, executableName);
const args = process.argv.slice(2);
const ipc = process.send !== undefined;
const stdio = ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit";
let child;
const fail = (error) => {
  if (!error) return;
  process.stderr.write("${FORK_IDENTITY.cliBin}: " + error.message + "\\n");
  child.kill("SIGTERM");
  process.exitCode = 1;
};
const attach = (started) => {
  child = started;
  if (ipc) {
    child.on("message", (message) => { if (process.connected) process.send(message, fail); });
  }
  child.on("exit", (code, signal) => process.exit(code ?? 128 + (constants.signals[signal] || 1)));
};
if (ipc) {
  process.on("message", (message) => { if (child.connected) child.send(message, fail); });
  process.on("disconnect", () => { if (child.connected) child.disconnect(); });
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
attach(spawn(executable, args, { stdio }));
child.on("error", (error) => {
  // A host whose libc cannot load the executable (NixOS, musl) reports ENOENT
  // or EACCES from exec. The bundle beside it runs under this Node instead.
  if (error.code === "ENOENT" || error.code === "EACCES") {
    attach(spawn(process.execPath, [join(packageDir, "bin.mjs"), ...args], { stdio }));
    child.on("error", (fallbackError) => { fail(fallbackError); process.exit(1); });
    return;
  }
  fail(error);
  process.exit(1);
});
`;
}
