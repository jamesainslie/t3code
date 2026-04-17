import {
  EnvironmentId,
  ProjectId,
  type RemoteIdentityKey,
  type SavedRemoteProject,
  makeRemoteIdentityKey,
  makeSavedProjectKey,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { Project } from "../../../types";
import { selectSidebarProjectEntries } from "../sidebarProjectsSelector";

const ENV_A = makeRemoteIdentityKey({
  host: "a.example.com",
  user: "james",
  port: 22,
  workspaceRoot: "/srv/a",
});
const ENV_B = makeRemoteIdentityKey({
  host: "b.example.com",
  user: "james",
  port: 22,
  workspaceRoot: "/srv/b",
});
const ENV_A_LIVE = EnvironmentId.make("env-live-a");
const ENV_B_LIVE = EnvironmentId.make("env-live-b");
const LOCAL_ENV = EnvironmentId.make("env-local");

function makeLiveProject(overrides: {
  id: string;
  name: string;
  environmentId?: EnvironmentId;
  cwd?: string;
  repositoryCanonicalKey?: string | null;
}): Project {
  const base: Project = {
    id: ProjectId.make(overrides.id),
    environmentId: overrides.environmentId ?? ENV_A_LIVE,
    name: overrides.name,
    cwd: overrides.cwd ?? `/live/${overrides.id}`,
    defaultModelSelection: null,
    scripts: [],
  };
  if (overrides.repositoryCanonicalKey === undefined) {
    return base;
  }
  if (overrides.repositoryCanonicalKey === null) {
    return { ...base, repositoryIdentity: null };
  }
  return {
    ...base,
    repositoryIdentity: {
      canonicalKey: overrides.repositoryCanonicalKey,
    } as NonNullable<Project["repositoryIdentity"]>,
  };
}

function makeSavedProject(overrides: {
  id: string;
  name: string;
  environmentIdentityKey?: RemoteIdentityKey;
  workspaceRoot?: string;
  repositoryCanonicalKey?: string | null;
  lastSyncedEnvironmentId?: EnvironmentId | null;
}): SavedRemoteProject {
  const environmentIdentityKey = overrides.environmentIdentityKey ?? ENV_A;
  const projectId = ProjectId.make(overrides.id);
  return {
    savedProjectKey: makeSavedProjectKey({ environmentIdentityKey, projectId }),
    environmentIdentityKey,
    projectId,
    name: overrides.name,
    workspaceRoot: overrides.workspaceRoot ?? `/saved/${overrides.id}`,
    repositoryCanonicalKey: overrides.repositoryCanonicalKey ?? null,
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-04-05T00:00:00.000Z",
    lastSyncedEnvironmentId: overrides.lastSyncedEnvironmentId ?? null,
  };
}

describe("selectSidebarProjectEntries", () => {
  it("returns an empty list when no live or saved projects exist", () => {
    expect(
      selectSidebarProjectEntries({
        liveProjects: [],
        savedProjects: [],
        identityKeyByEnvironmentId: {},
      }),
    ).toEqual([]);
  });

  it("marks live projects with an identityKey as non-stale, suppressing duplicate saved entries", () => {
    const liveProject = makeLiveProject({ id: "proj-1", name: "Alpha" });
    const savedProject = makeSavedProject({
      id: "proj-1",
      name: "Alpha (stale)",
      environmentIdentityKey: ENV_A,
    });

    const entries = selectSidebarProjectEntries({
      liveProjects: [liveProject],
      savedProjects: [savedProject],
      identityKeyByEnvironmentId: { [ENV_A_LIVE]: ENV_A },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.isStale).toBe(false);
    expect(entries[0]!.name).toBe("Alpha");
    expect(entries[0]!.environmentIdentityKey).toBe(ENV_A);
    expect(entries[0]!.liveEnvironmentId).toBe(ENV_A_LIVE);
    expect(entries[0]!.key).toBe(
      makeSavedProjectKey({ environmentIdentityKey: ENV_A, projectId: ProjectId.make("proj-1") }),
    );
  });

  it("emits a stale entry for saved projects with no live counterpart", () => {
    const savedProject = makeSavedProject({
      id: "proj-2",
      name: "Beta",
      environmentIdentityKey: ENV_A,
    });

    const entries = selectSidebarProjectEntries({
      liveProjects: [],
      savedProjects: [savedProject],
      identityKeyByEnvironmentId: {},
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.isStale).toBe(true);
    expect(entries[0]!.liveEnvironmentId).toBeNull();
    expect(entries[0]!.environmentIdentityKey).toBe(ENV_A);
    expect(entries[0]!.name).toBe("Beta");
  });

  it("uses a local# prefix key for live projects with no saved environment", () => {
    const liveProject = makeLiveProject({
      id: "proj-local",
      name: "Local",
      environmentId: LOCAL_ENV,
    });

    const entries = selectSidebarProjectEntries({
      liveProjects: [liveProject],
      savedProjects: [],
      identityKeyByEnvironmentId: {},
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.environmentIdentityKey).toBeNull();
    expect(entries[0]!.key).toBe("local#proj-local");
    expect(entries[0]!.isStale).toBe(false);
  });

  it("merges live and saved entries across multiple environments", () => {
    const entries = selectSidebarProjectEntries({
      liveProjects: [
        makeLiveProject({ id: "proj-live-a", name: "LiveA", environmentId: ENV_A_LIVE }),
        makeLiveProject({ id: "proj-live-b", name: "LiveB", environmentId: ENV_B_LIVE }),
      ],
      savedProjects: [
        makeSavedProject({ id: "proj-stale-a", name: "StaleA", environmentIdentityKey: ENV_A }),
        makeSavedProject({ id: "proj-stale-b", name: "StaleB", environmentIdentityKey: ENV_B }),
      ],
      identityKeyByEnvironmentId: { [ENV_A_LIVE]: ENV_A, [ENV_B_LIVE]: ENV_B },
    });

    expect(entries.map((entry) => entry.name)).toEqual(["LiveA", "LiveB", "StaleA", "StaleB"]);
    expect(entries.filter((entry) => entry.isStale).map((entry) => entry.name)).toEqual([
      "StaleA",
      "StaleB",
    ]);
  });

  it("sorts by name then workspaceRoot", () => {
    const entries = selectSidebarProjectEntries({
      liveProjects: [
        makeLiveProject({ id: "proj-zeta", name: "Zeta" }),
        makeLiveProject({ id: "proj-alpha", name: "Alpha" }),
      ],
      savedProjects: [
        makeSavedProject({
          id: "proj-alpha-other",
          name: "Alpha",
          environmentIdentityKey: ENV_B,
          workspaceRoot: "/zz",
        }),
        makeSavedProject({
          id: "proj-zeta-other",
          name: "Zeta",
          environmentIdentityKey: ENV_B,
          workspaceRoot: "/aa",
        }),
      ],
      identityKeyByEnvironmentId: { [ENV_A_LIVE]: ENV_A },
    });

    const names = entries.map((entry) => entry.name);
    expect(names).toEqual(["Alpha", "Alpha", "Zeta", "Zeta"]);
    // Within each name group, workspaceRoot determines order.
    expect(entries[0]!.workspaceRoot.localeCompare(entries[1]!.workspaceRoot)).toBeLessThan(0);
    expect(entries[2]!.workspaceRoot.localeCompare(entries[3]!.workspaceRoot)).toBeLessThan(0);
  });

  it("extracts repositoryIdentity.canonicalKey from live projects when present", () => {
    const liveProject = makeLiveProject({
      id: "proj-1",
      name: "Repo project",
      repositoryCanonicalKey: "git:repo-xyz",
    });

    const entries = selectSidebarProjectEntries({
      liveProjects: [liveProject],
      savedProjects: [],
      identityKeyByEnvironmentId: {},
    });

    expect(entries[0]!.repositoryCanonicalKey).toBe("git:repo-xyz");
  });
});
