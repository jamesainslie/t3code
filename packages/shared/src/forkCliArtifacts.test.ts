// @effect-diagnostics nodeBuiltinImport:off - builds real runtime directories on disk and runs a real shell over them.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  forkCliArchiveFileNameIn,
  forkCliArchiveFileNames,
  forkCliArchiveShell,
  forkCliExecutableNames,
  forkCliExecutablePath,
  forkCliExecutableShell,
  FORK_NPM_LAUNCHER_SCRIPTS,
} from "./forkCliArtifacts.ts";
import * as HostProcess from "./HostProcess.ts";

const dirs: string[] = [];
const makeDir = (...executables: string[]) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-cli-artifacts-"));
  dirs.push(dir);
  for (const name of executables) {
    NodeFS.writeFileSync(NodePath.join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
  }
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

describe("forkCliExecutableNames", () => {
  it("names the Lathe executable first and upstream's after it", () => {
    expect(forkCliExecutableNames("linux")).toEqual(["lathe", "t3"]);
    expect(forkCliExecutableNames("darwin")).toEqual(["lathe", "t3"]);
    expect(forkCliExecutableNames("win32")).toEqual(["lathe.exe", "t3.exe"]);
  });
});

describe("forkCliExecutablePath", () => {
  const pick = (dir: string, platform: NodeJS.Platform = "linux") =>
    NodePath.basename(forkCliExecutablePath(dir, platform, NodePath.join, NodeFS.existsSync));

  it("runs lathe from a runtime that has both names", () => {
    expect(pick(makeDir("lathe", "t3"))).toBe("lathe");
  });

  it("falls back to t3 in a runtime unpacked before the rename", () => {
    expect(pick(makeDir("t3"))).toBe("t3");
  });

  it("expects lathe in a runtime that is not unpacked yet", () => {
    expect(pick(makeDir())).toBe("lathe");
  });

  it("uses the .exe names on Windows", () => {
    expect(pick(makeDir("t3.exe"), "win32")).toBe("t3.exe");
    expect(pick(makeDir("lathe.exe", "t3.exe"), "win32")).toBe("lathe.exe");
  });
});

describe("forkCliArchiveFileNames", () => {
  it("names the Lathe archive first and upstream's after it", () => {
    expect(forkCliArchiveFileNames("1.2.3-nightly.20261009.1", "linux-x64")).toEqual([
      "lathe-1.2.3-nightly.20261009.1-linux-x64.tar.gz",
      "t3-1.2.3-nightly.20261009.1-linux-x64.tar.gz",
    ]);
    expect(forkCliArchiveFileNames("1.2.3", "win32-arm64")).toEqual([
      "lathe-1.2.3-win32-arm64.zip",
      "t3-1.2.3-win32-arm64.zip",
    ]);
  });
});

describe("forkCliArchiveFileNameIn", () => {
  const sums = (...names: string[]) => new Map(names.map((name) => [name, "0".repeat(64)]));

  it("downloads the Lathe archive from a release that publishes both names", () => {
    expect(
      forkCliArchiveFileNameIn(
        sums("t3-1.2.3-darwin-arm64.tar.gz", "lathe-1.2.3-darwin-arm64.tar.gz"),
        "1.2.3",
        "darwin-arm64",
      ),
    ).toBe("lathe-1.2.3-darwin-arm64.tar.gz");
  });

  it("downloads the t3 archive from a release published before the rename", () => {
    expect(
      forkCliArchiveFileNameIn(sums("t3-1.2.3-darwin-arm64.tar.gz"), "1.2.3", "darwin-arm64"),
    ).toBe("t3-1.2.3-darwin-arm64.tar.gz");
  });

  it("names the Lathe archive when the release lists neither", () => {
    expect(forkCliArchiveFileNameIn(sums(), "1.2.3", "darwin-arm64")).toBe(
      "lathe-1.2.3-darwin-arm64.tar.gz",
    );
  });
});

describe("FORK_NPM_LAUNCHER_SCRIPTS", () => {
  it("publishes bin/lathe.js and still recognises the pre-rename bin/t3.js", () => {
    expect(FORK_NPM_LAUNCHER_SCRIPTS).toEqual(["bin/lathe.js", "bin/t3.js"]);
  });
});

const sh = (script: string, cwd: string) =>
  NodeChildProcess.execFileSync("sh", ["-c", script], { cwd, encoding: "utf8" });

// The SSH runner and install scripts resolve names in a remote shell, so each
// expression must agree with its TypeScript counterpart on every layout.
describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("shell rules", () => {
  it.each<readonly [string, ReadonlyArray<string>]>([
    ["both names", ["lathe", "t3"]],
    ["only the pre-rename name", ["t3"]],
    ["only the Lathe name", ["lathe"]],
  ])("forkCliExecutableShell picks the same executable for %s", (_, executables) => {
    const dir = makeDir(...executables);
    expect(sh(`D="$PWD"; printf %s "${forkCliExecutableShell("$D")}"`, dir)).toBe(
      forkCliExecutablePath(NodeFS.realpathSync(dir), "linux", NodePath.join, NodeFS.existsSync),
    );
  });

  it.each<readonly [string, ReadonlyArray<string>, string]>([
    [
      "both names",
      ["t3-1.2.3-linux-x64.tar.gz", "lathe-1.2.3-linux-x64.tar.gz"],
      "lathe-1.2.3-linux-x64.tar.gz",
    ],
    ["only the pre-rename name", ["t3-1.2.3-linux-x64.tar.gz"], "t3-1.2.3-linux-x64.tar.gz"],
    // A binary-mode `*name` entry counts, and a name that merely ends in the
    // archive's name does not.
    ["a binary-mode entry", ["*lathe-1.2.3-linux-x64.tar.gz"], "lathe-1.2.3-linux-x64.tar.gz"],
    [
      "a lookalike name",
      ["xlathe-1.2.3-linux-x64.tar.gz", "t3-1.2.3-linux-x64.tar.gz"],
      "t3-1.2.3-linux-x64.tar.gz",
    ],
    ["neither name", [], "lathe-1.2.3-linux-x64.tar.gz"],
  ])("forkCliArchiveShell picks the archive SHA256SUMS lists for %s", (_, listed, expected) => {
    const dir = makeDir();
    NodeFS.writeFileSync(
      NodePath.join(dir, "SHA256SUMS"),
      listed.map((name) => `${"a".repeat(64)}  ${name}\n`).join(""),
    );
    const script = [
      "set -eu",
      "V=1.2.3; P=linux; A=x64",
      `printf %s "${forkCliArchiveShell("$PWD/SHA256SUMS", "$V-$P-$A.tar.gz")}"`,
    ].join("\n");
    expect(sh(script, dir)).toBe(expected);
  });
});
