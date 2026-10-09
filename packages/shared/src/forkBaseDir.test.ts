// @effect-diagnostics nodeBuiltinImport:off - builds real directory layouts on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { forkBaseDirName } from "./forkBaseDir.ts";
import { FORK_IDENTITY } from "./forkIdentity.ts";

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
