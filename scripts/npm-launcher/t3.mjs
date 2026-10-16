#!/usr/bin/env node
// The `t3` npm package. Downloads this version's CLI archive from the GitHub
// Release into <T3 home>/runtime/versions/<version> (the folder the install
// scripts and `t3 update` use), verifies it against the release's SHA256SUMS,
// then runs it. `dist/bin.mjs` re-enters here for background services
// installed before 0.0.41, which start the npm package with Node and talk to
// it over an IPC channel.
//
// Fork: this script runs as published, so it cannot import FORK_IDENTITY. Its
// fork values (release repository, `.lathe` home with the `.t3f` fallback,
// `lathe-`/`t3-` archive and executable names) mirror forkIdentity.ts,
// forkBaseDir.ts and forkCliArtifacts.ts; scripts/build-npm-launcher.test.ts
// checks them.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { version } = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
);

// Fork: the fork's release builds no Windows CLI archives.
const SUPPORTED = ["darwin-arm64", "linux-arm64", "linux-x64"];

// Fork: the executable and archive names, Lathe first (forkCliArtifacts.ts).
const CLI_NAMES = ["lathe", "t3"];

/** Fork: `.lathe`, or a pre-rename `.t3f` while it is the one in use (forkBaseDir.ts). */
function defaultHome() {
  const lathe = path.join(os.homedir(), ".lathe");
  const legacy = path.join(os.homedir(), ".t3f");
  return !fs.existsSync(lathe) && fs.existsSync(legacy) ? legacy : lathe;
}

function t3Home() {
  const raw = (process.env.T3CODE_HOME || "").trim();
  if (raw === "") return defaultHome();
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/") || raw.startsWith("~\\")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

async function get(url) {
  const response = await fetch(url);
  if (response.status === 404) {
    throw new Error(
      `${url} does not exist yet. If ${version} was just released, try again in a few minutes.`,
    );
  }
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return response;
}

/** Downloads `url` to `file` and returns its sha256, showing progress on a terminal. */
async function download(url, file) {
  const response = await get(url);
  const total = Number(response.headers.get("content-length")) || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.openSync(file, "w");
  const tty = process.stderr.isTTY;
  let received = 0;
  let shown = -1;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      fs.writeSync(out, chunk);
      received += chunk.byteLength;
      // Redraw once per percent (or per MB without a length), not per chunk.
      const step = total ? Math.floor((received * 100) / total) : Math.floor(received / 1048576);
      if (tty && step !== shown) {
        shown = step;
        const percent = total ? ` ${step}%` : "";
        process.stderr.write(
          `\r\x1b[2Klathe: downloading Lathe ${version}${percent} (${(received / 1048576).toFixed(1)} MB)`,
        );
      }
    }
  } finally {
    fs.closeSync(out);
    if (tty) process.stderr.write("\r\x1b[2K");
  }
  return hash.digest("hex");
}

async function install(dir, key) {
  const suffix = `${version}-${key}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
  const base = (
    process.env.T3CODE_RELEASE_BASE_URL ||
    "https://github.com/jamesainslie/t3code/releases/download"
  ).replace(/\/+$/, "");
  const sums = await (await get(`${base}/v${version}/SHA256SUMS`)).text();
  const expected = /^([0-9a-f]{64})\s+\*?(.+)$/im;
  const listed = sums.split(/\r?\n/).map((l) => expected.exec(l.trim()));
  // Fork: a release after the Lathe rename lists `lathe-*`, one before it only `t3-*`.
  const archive =
    CLI_NAMES.map((name) => `${name}-${suffix}`).find((name) =>
      listed.some((m) => m && m[2] === name),
    ) ?? `${CLI_NAMES[0]}-${suffix}`;
  const line = listed.find((m) => m && m[2] === archive);
  if (!line) throw new Error(`${archive} is not listed in the release's SHA256SUMS`);

  // Extract beside the final folder and rename it into place, so an
  // interrupted download never leaves a half-installed version behind.
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const staging = fs.mkdtempSync(`${dir}.staging-`);
  try {
    const file = path.join(staging, archive);
    if ((await download(`${base}/v${version}/${archive}`, file)) !== line[1].toLowerCase()) {
      throw new Error(`checksum mismatch for ${archive}`);
    }
    // Windows' own tar.exe reads zip; a Git-for-Windows tar on PATH cannot.
    const tar =
      process.platform === "win32" ? `${process.env.SystemRoot}\\System32\\tar.exe` : "tar";
    const extract = spawnSync(tar, ["-xf", file, "-C", staging, "--strip-components=1"], {
      stdio: "inherit",
    });
    if (extract.status !== 0) throw new Error(`could not extract ${archive}`);
    fs.rmSync(file);
    fs.writeFileSync(path.join(staging, ".install-complete"), `${version}\n`);
    publish(staging, dir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

const isComplete = (dir) => {
  try {
    return fs.readFileSync(path.join(dir, ".install-complete"), "utf8").trim() === version;
  } catch {
    return false;
  }
};

/**
 * Moves a finished staging folder to `dir`. Rename never replaces an existing
 * folder, so a complete install another launcher (or `t3 update`) published
 * first is kept, never deleted from under a running process. Only a folder
 * without the completion marker, left by an interrupted older installer, is
 * cleared before trying again.
 */
function publish(staging, dir) {
  try {
    fs.renameSync(staging, dir);
  } catch (error) {
    if (isComplete(dir)) return;
    if (!fs.existsSync(dir)) throw error;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  }
}

async function main() {
  const key = `${process.platform}-${process.arch}`;
  if (!SUPPORTED.includes(key)) {
    throw new Error(
      `no Lathe CLI build is available for ${key} (supported: ${SUPPORTED.join(", ")}).\n` +
        "The desktop app is at https://github.com/jamesainslie/t3code/releases",
    );
  }
  const dir = path.join(t3Home(), "runtime", "versions", version);
  if (!isComplete(dir)) await install(dir, key);

  // A service launcher talks to its server over IPC; pass that channel and
  // signals through. In a terminal, Ctrl-C already reaches the child directly,
  // so forwarding SIGINT too would deliver it twice.
  const ipc = process.send !== undefined;
  const args = process.argv.slice(2);
  let child;
  const start = (file, fileArgs) => {
    child = spawn(file, fileArgs, {
      stdio: ipc ? ["inherit", "inherit", "inherit", "ipc"] : "inherit",
      // The executable lives in the T3 home, so this is how it knows npm launched it.
      env: { ...process.env, T3CODE_NPM_LAUNCHER_PATH: import.meta.filename },
    });
    if (ipc) child.on("message", (message) => process.connected && process.send(message));
    child.on("error", (error) => {
      // Fork: a host whose libc cannot load the executable (NixOS, musl)
      // fails exec with ENOENT or EACCES. This launcher already runs under a
      // Node that can run the archive's server bundle as a script, so use it.
      const bundle = path.join(dir, "bin.mjs");
      if (
        file !== process.execPath &&
        ["ENOENT", "EACCES"].includes(error.code) &&
        fs.existsSync(bundle)
      ) {
        start(process.execPath, [bundle, ...args]);
        return;
      }
      fail(error);
    });
    child.on("exit", (code, signal) =>
      process.exit(code ?? 128 + (os.constants.signals[signal] || 1)),
    );
  };
  const executableName = (name) => (process.platform === "win32" ? `${name}.exe` : name);
  // Fork: `<dir>/lathe`, or `<dir>/t3` in a runtime unpacked before the rename.
  start(
    CLI_NAMES.map((name) => path.join(dir, executableName(name))).find((file) =>
      fs.existsSync(file),
    ) ?? path.join(dir, executableName(CLI_NAMES[0])),
    args,
  );
  if (ipc) {
    process.on("message", (message) => child.connected && child.send(message));
    process.on("disconnect", () => child.connected && child.disconnect());
  }
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => (ipc || signal !== "SIGINT") && child.kill(signal));
  }
}

function fail(error) {
  process.stderr.write(`lathe: ${error.message}\n`);
  process.exit(1);
}

await main().catch(fail);
