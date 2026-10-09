// @effect-diagnostics nodeBuiltinImport:off - checks the tracked icon files on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import { describe, expect, it } from "vite-plus/test";

import { BRAND_ASSET_PATHS } from "./brand-assets.ts";
import { forkBrandAssetPaths } from "./forkBrandAssets.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..");

describe("forkBrandAssetPaths", () => {
  it("moves upstream asset paths under the fork's icon directory", () => {
    expect(
      forkBrandAssetPaths({
        project: "assets/prod/app-icon.icon",
        favicon: "assets/dev/blueprint-web-favicon.ico",
      }),
    ).toEqual({
      project: `${FORK_IDENTITY.assetsDir}/prod/app-icon.icon`,
      favicon: `${FORK_IDENTITY.assetsDir}/dev/blueprint-web-favicon.ico`,
    });
  });

  it("finds every brand asset the build reads in the fork's icon directory", () => {
    const missing = Object.values(BRAND_ASSET_PATHS).filter(
      (relativePath) =>
        !relativePath.startsWith(`${FORK_IDENTITY.assetsDir}/`) ||
        !NodeFS.existsSync(NodePath.join(repoRoot, relativePath)),
    );
    expect(missing).toEqual([]);
  });
});
