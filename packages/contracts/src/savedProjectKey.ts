import type { EnvironmentId, ProjectId } from "./baseSchemas.ts";
import { ProjectId as ProjectIdSchema } from "./baseSchemas.ts";
import type { RemoteIdentityKey } from "./remoteIdentity.ts";
import { parseRemoteIdentityKey } from "./remoteIdentity.ts";

/**
 * Branded stable key for a persisted remote project. Composed as
 * `${environmentIdentityKey}#${projectId}`. The environment identity key never
 * contains `#`, so parsing splits on the first `#` and any `#` in the project
 * id stays with the project id.
 */
export type SavedProjectKey = string & { readonly _tag: "SavedProjectKey" };

export interface SavedProjectKeyFields {
  readonly environmentIdentityKey: RemoteIdentityKey;
  readonly projectId: ProjectId;
}

export function makeSavedProjectKey(fields: SavedProjectKeyFields): SavedProjectKey {
  return `${fields.environmentIdentityKey}#${fields.projectId}` as SavedProjectKey;
}

export function parseSavedProjectKey(key: string): SavedProjectKeyFields | null {
  const delimiter = key.indexOf("#");
  if (delimiter <= 0 || delimiter === key.length - 1) return null;
  const envPart = key.slice(0, delimiter);
  const projectPart = key.slice(delimiter + 1);
  if (!parseRemoteIdentityKey(envPart)) return null;
  if (projectPart.length === 0) return null;
  return {
    environmentIdentityKey: envPart as RemoteIdentityKey,
    projectId: ProjectIdSchema.make(projectPart),
  };
}

/**
 * Persistent record shape for a saved remote project.
 *
 * - `savedProjectKey` — branded composite key, unique per (env, project)
 * - `environmentIdentityKey` — FK to the parent `SavedRemoteEnvironment`
 * - `projectId` — server-assigned id, stable within its owning environment
 * - `name` / `workspaceRoot` — cached display metadata; refreshed on every sync
 * - `repositoryCanonicalKey` — optional grouping key across environments
 * - `lastSyncedEnvironmentId` — the live `EnvironmentId` used during the most
 *   recent successful sync, for convenience when routing a reconnect
 */
export interface SavedRemoteProject {
  readonly savedProjectKey: SavedProjectKey;
  readonly environmentIdentityKey: RemoteIdentityKey;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryCanonicalKey: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastSyncedEnvironmentId: EnvironmentId | null;
}

/**
 * Storage-layer shape: strings only, no brands. Branded values are
 * reconstructed at hydration time.
 */
export interface PersistedSavedProjectRecord {
  readonly savedProjectKey: string;
  readonly environmentIdentityKey: string;
  readonly projectId: string;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryCanonicalKey: string | null;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastSyncedEnvironmentId: string | null;
}
