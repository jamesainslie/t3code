import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";

const production = FORK_IDENTITY.desktop.production;

/**
 * Fork-only. The renderer's localStorage from before the Lathe rename. The
 * profile folder stays in use (`legacyUserDataDirName`), but the scheme, and
 * with it the storage origin, changed from `t3code-fork://app` to
 * `lathe://app`, which hides the old items. `DesktopLegacyLocalStorage`
 * imports them once from the old origin. Its own marker name is used because
 * the upstream V1 import already wrote `v1-local-storage-imported` into that
 * profile.
 */
export const FORK_LEGACY_LOCAL_STORAGE = {
  profileNames: [production.legacyUserDataDirName],
  origin: `${production.legacyScheme}://app`,
  markerFileName: "lathe-local-storage-imported",
} as const;
