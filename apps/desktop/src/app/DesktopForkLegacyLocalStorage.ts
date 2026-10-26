import { FORK_IDENTITY } from "@lathe/shared/forkIdentity";

const production = FORK_IDENTITY.desktop.production;

/**
 * Fork-only. Renderer localStorage from before the Lathe rename: the profile folder stays
 * (`legacyUserDataDirName`), but the scheme, and so the storage origin, moved from
 * `t3code-fork://app` to `lathe://app`, hiding the old items until `DesktopLegacyLocalStorage`
 * imports them once. Its own marker name avoids the upstream V1 `v1-local-storage-imported`.
 */
export const FORK_LEGACY_LOCAL_STORAGE = {
  profileNames: [production.legacyUserDataDirName],
  origin: `${production.legacyScheme}://app`,
  markerFileName: "lathe-local-storage-imported",
} as const;
