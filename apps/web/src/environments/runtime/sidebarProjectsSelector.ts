import type {
  EnvironmentId,
  ProjectId,
  RemoteIdentityKey,
  SavedRemoteProject,
} from "@t3tools/contracts";
import { makeSavedProjectKey } from "@t3tools/contracts";

import type { Project } from "../../types";

/**
 * Unified entry displayed in the sidebar project list. Produced by merging
 * live orchestration projects (from the active read model) with the persisted
 * saved-project registry so remote projects remain visible when their parent
 * environment is disconnected.
 */
export interface SidebarProjectEntry {
  /** Stable React key. For live local projects this is `local#${projectId}`;
   * for everything keyed to a saved environment it's the branded SavedProjectKey. */
  readonly key: string;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly workspaceRoot: string;
  readonly repositoryCanonicalKey: string | null;
  /** Non-null when the live project is currently loaded in the read model. */
  readonly liveEnvironmentId: EnvironmentId | null;
  /** Non-null when the project belongs to a *saved* remote environment. */
  readonly environmentIdentityKey: RemoteIdentityKey | null;
  /** True when the entry is only known from persisted state (no live read-model entry). */
  readonly isStale: boolean;
}

interface SelectorInput {
  readonly liveProjects: ReadonlyArray<Project>;
  readonly savedProjects: ReadonlyArray<SavedRemoteProject>;
  readonly identityKeyByEnvironmentId: Readonly<Record<EnvironmentId, RemoteIdentityKey>>;
}

/**
 * Pure selector. Produces a deduplicated, name-sorted list of sidebar entries:
 *
 * - Every live project yields one entry. If its environmentId maps to a saved
 *   identityKey, the entry is keyed by `SavedProjectKey` so it naturally
 *   deduplicates against the persisted entry.
 * - Every saved project whose (identityKey, projectId) was not produced by a
 *   live project yields one *stale* entry.
 *
 * Stable sort by display name, with a secondary tie-break on workspaceRoot.
 */
export function selectSidebarProjectEntries(input: SelectorInput): readonly SidebarProjectEntry[] {
  const { liveProjects, savedProjects, identityKeyByEnvironmentId } = input;

  const entries: SidebarProjectEntry[] = [];
  const seenSavedKeys = new Set<string>();

  for (const project of liveProjects) {
    const identityKey = identityKeyByEnvironmentId[project.environmentId] ?? null;
    const key = identityKey
      ? makeSavedProjectKey({ environmentIdentityKey: identityKey, projectId: project.id })
      : `local#${project.id}`;
    if (identityKey) {
      seenSavedKeys.add(key);
    }
    entries.push({
      key,
      projectId: project.id,
      name: project.name,
      workspaceRoot: project.cwd,
      repositoryCanonicalKey: project.repositoryIdentity?.canonicalKey ?? null,
      liveEnvironmentId: project.environmentId,
      environmentIdentityKey: identityKey,
      isStale: false,
    });
  }

  for (const saved of savedProjects) {
    if (seenSavedKeys.has(saved.savedProjectKey)) continue;
    entries.push({
      key: saved.savedProjectKey,
      projectId: saved.projectId,
      name: saved.name,
      workspaceRoot: saved.workspaceRoot,
      repositoryCanonicalKey: saved.repositoryCanonicalKey,
      liveEnvironmentId: null,
      environmentIdentityKey: saved.environmentIdentityKey,
      isStale: true,
    });
  }

  return entries.toSorted((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.workspaceRoot.localeCompare(right.workspaceRoot);
  });
}
