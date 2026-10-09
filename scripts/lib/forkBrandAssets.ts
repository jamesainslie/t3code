import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";

/**
 * Fork-only. Upstream's brand asset paths, moved from `assets/` to the fork's
 * icon directory (`FORK_IDENTITY.assetsDir`). The fork keeps upstream's file
 * names there, so `brand-assets.ts` keeps its upstream entries and maps them
 * through this in one line, and upstream changes to those entries still merge.
 */
export const forkBrandAssetPaths = <T extends Readonly<Record<string, string>>>(
  paths: T,
): { readonly [K in keyof T]: string } =>
  Object.fromEntries(
    Object.entries(paths).map(([key, value]) => [
      key,
      value.replace(/^assets\//, `${FORK_IDENTITY.assetsDir}/`),
    ]),
  ) as { readonly [K in keyof T]: string };
