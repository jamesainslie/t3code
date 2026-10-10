// @effect-diagnostics nodeBuiltinImport:off - builds real directory layouts on disk and runs a real shell over them.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { FORK_HOME_SHELL, forkBaseDirName } from "./forkBaseDir.ts";
import { FORK_IDENTITY } from "./forkIdentity.ts";
import * as HostProcess from "./HostProcess.ts";

const parents: string[] = [];
const makeParent = (...existing: string[]) => {
  const parent = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-base-dir-"));
  parents.push(parent);
  for (const name of existing) NodeFS.mkdirSync(NodePath.join(parent, name));
  return parent;
};

afterEach(() => {
  for (const parent of parents.splice(0)) NodeFS.rmSync(parent, { recursive: true, force: true });
});

describe("forkBaseDirName", () => {
  it("uses the Lathe directory on a fresh machine", () => {
    expect(forkBaseDirName(makeParent())).toBe(FORK_IDENTITY.baseDirName);
  });

  it("keeps using an existing pre-rename directory in place", () => {
    expect(forkBaseDirName(makeParent(FORK_IDENTITY.legacyBaseDirName))).toBe(
      FORK_IDENTITY.legacyBaseDirName,
    );
  });

  it("prefers the Lathe directory once it exists, even beside the old one", () => {
    expect(
      forkBaseDirName(makeParent(FORK_IDENTITY.baseDirName, FORK_IDENTITY.legacyBaseDirName)),
    ).toBe(FORK_IDENTITY.baseDirName);
  });
});

const evaluateShell = (home: string) =>
  NodeChildProcess.execFileSync("sh", ["-c", `printf %s "${FORK_HOME_SHELL}"`], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });

// Remote hosts (SSH, WSL) resolve the base directory in their own shell, so
// the expression must agree with forkBaseDirName on every layout.
describe.skipIf(HostProcess.Platform.defaultValue() === "win32")("FORK_HOME_SHELL", () => {
  it.each<readonly [string, ReadonlyArray<string>]>([
    ["a fresh home", []],
    ["a home with only the pre-rename directory", [FORK_IDENTITY.legacyBaseDirName]],
    ["a home with only the Lathe directory", [FORK_IDENTITY.baseDirName]],
    ["a home with both directories", [FORK_IDENTITY.baseDirName, FORK_IDENTITY.legacyBaseDirName]],
  ])("picks the same directory as forkBaseDirName for %s", (_, existing) => {
    const home = makeParent(...existing);
    expect(evaluateShell(home)).toBe(NodePath.join(home, forkBaseDirName(home)));
  });
});
