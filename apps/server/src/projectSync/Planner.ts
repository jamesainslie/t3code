import {
  ProjectId,
  ThreadId,
  type ProjectSyncMapping,
  type ProjectSyncProjectSnapshot,
  type ProjectSyncRecord,
} from "@t3tools/contracts";
import { contentHash, type SyncSource, type SyncThread } from "./Source.ts";

/** Identifies the source conversation across its content-addressed imported versions. */
export function syncedThreadKey(threadId: string): string {
  return threadId.slice(0, threadId.lastIndexOf("-"));
}

export interface SyncedThreadManagement {
  deleted?: true;
  archived?: boolean;
  settledOverride?: "settled" | "active";
}

/** What the planner needs to know about an imported thread version already in this install. */
export interface SyncedThreadState {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly deletedAt: string | null;
  readonly archivedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
}

const settingsKeys = [
  "title",
  "defaultModelSelection",
  "defaultThreadEnvMode",
  "autoPull",
  "projectIcon",
  "scripts",
] as const;
export type ProjectSettings = ReturnType<typeof projectSettings>;

export function projectSettings(project: ProjectSyncProjectSnapshot) {
  return {
    title: project.title,
    defaultModelSelection: project.defaultModelSelection,
    defaultThreadEnvMode: project.defaultThreadEnvMode ?? null,
    autoPull: project.autoPull ?? false,
    projectIcon: project.projectIcon ?? null,
    scripts: project.scripts,
  };
}

/** One change a sync batch makes. `Apply.ts` turns these into project commands and v2 events. */
export type SyncStep =
  | {
      readonly type: "project.create";
      readonly projectId: ProjectId;
      readonly project: ProjectSyncProjectSnapshot;
    }
  | {
      readonly type: "project.update";
      readonly projectId: ProjectId;
      readonly settings: Partial<ProjectSettings>;
    }
  | { readonly type: "project.delete"; readonly projectId: ProjectId }
  | {
      readonly type: "thread.import";
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly thread: SyncThread;
    }
  | { readonly type: "thread.visibility"; readonly threadId: ThreadId; readonly visible: boolean }
  | {
      readonly type: "thread.archive" | "thread.unarchive" | "thread.settle" | "thread.unsettle";
      readonly threadId: ThreadId;
    };

export interface SyncPlan {
  readonly steps: ReadonlyArray<SyncStep>;
  readonly record: ProjectSyncRecord;
}

/** Reapplies local organization when replacing or restoring an imported version. */
export function planThreadManagement(
  threadId: ThreadId,
  existing: Pick<SyncedThreadState, "archivedAt" | "settledOverride"> | undefined,
  local: SyncedThreadManagement | undefined,
): SyncStep[] {
  const steps: SyncStep[] = [];
  let archived = existing?.archivedAt != null;
  const desiredArchive = local?.archived ?? (existing ? archived : true);
  if (local?.settledOverride !== undefined && local.settledOverride !== existing?.settledOverride) {
    if (archived) {
      steps.push({ type: "thread.unarchive", threadId });
      archived = false;
    }
    steps.push({
      type: local.settledOverride === "settled" ? "thread.settle" : "thread.unsettle",
      threadId,
    });
  }
  if (desiredArchive !== archived) {
    steps.push({ type: desiredArchive ? "thread.archive" : "thread.unarchive", threadId });
  }
  return steps;
}

export function activeSyncRecord(
  history: ReadonlyArray<ProjectSyncRecord>,
): ProjectSyncRecord | null {
  const latest = history[0];
  if (!latest) return null;
  return latest.undoBatchId === null
    ? latest
    : (history.find((entry) => entry.id === latest.parentId) ?? null);
}

function activeHistory(history: ReadonlyArray<ProjectSyncRecord>): ProjectSyncRecord[] {
  const records: ProjectSyncRecord[] = [];
  let record = activeSyncRecord(history);
  while (record && !records.includes(record)) {
    records.push(record);
    record = history.find((entry) => entry.id === record?.parentId) ?? null;
  }
  return records;
}

/** The content-addressed id of one imported version of a source conversation. */
export function syncedThreadId(sourceId: string, thread: SyncThread, projectId: ProjectId) {
  const prefix = `t3sync-${sourceId.slice(0, 12)}-${contentHash(thread.id).slice(0, 12)}-`;
  return {
    prefix,
    threadId: ThreadId.make(`${prefix}${contentHash({ thread, projectId }).slice(0, 20)}`),
  };
}

export function planImport(input: {
  source: SyncSource;
  /** Every project in this install, deleted ones included. */
  projects: ReadonlyArray<ProjectSyncProjectSnapshot>;
  /** Every imported thread version in this install, hidden ones included. */
  threads: ReadonlyArray<SyncedThreadState>;
  history: ReadonlyArray<ProjectSyncRecord>;
  mappings: ReadonlyArray<ProjectSyncMapping>;
  batchId: string;
  now: string;
  localSettingOverrides?: ReadonlyMap<ProjectId, ReadonlySet<string>>;
  localThreadManagement?: ReadonlyMap<string, SyncedThreadManagement>;
}): SyncPlan {
  const steps: SyncStep[] = [];
  const changes: ProjectSyncRecord["projectChanges"][number][] = [];
  const visible: ThreadId[] = [];
  const hidden: ThreadId[] = [];
  for (const entry of input.source.projects) {
    const projectId = input.mappings.find(
      (mapping) => mapping.sourceProjectId === entry.project.id,
    )?.projectId;
    if (!projectId) continue;
    if (entry.warnings.some((warning) => warning.includes("remote host")))
      throw new Error(
        `Cannot import remote project ${entry.project.title}. Skip it in the preview.`,
      );
    const existing = input.projects.find((project) => project.id === projectId);
    if (existing?.deletedAt)
      throw new Error(
        `The mapped project ${existing.title} has been deleted. Choose a new destination.`,
      );
    if (!existing) {
      const after = { ...entry.project, id: projectId };
      steps.push({ type: "project.create", projectId, project: after });
      changes.push({ before: null, after, ownedSettings: [...settingsKeys] });
    } else {
      const previous = activeHistory(input.history)
        .flatMap((record) => record.projectChanges)
        .find((change) => change.after.id === projectId);
      if (previous) {
        const current = projectSettings(existing);
        const lastImported = projectSettings(previous.after);
        const incoming = projectSettings(entry.project);
        const merged = { ...current };
        const ownedSettings = (previous.ownedSettings ?? settingsKeys).filter(
          (key) =>
            !input.localSettingOverrides?.get(projectId)?.has(key) &&
            settingsKeys.some(
              (candidate) =>
                candidate === key &&
                contentHash(current[candidate]) === contentHash(lastImported[candidate]),
            ),
        );
        for (const key of settingsKeys) {
          if (ownedSettings.includes(key)) Object.assign(merged, { [key]: incoming[key] });
        }
        if (contentHash(current) !== contentHash(merged)) {
          steps.push({ type: "project.update", projectId, settings: merged });
          changes.push({
            before: existing,
            after: { ...existing, ...merged, updatedAt: input.now },
            ownedSettings,
          });
        }
      }
    }
    for (const thread of entry.threads) {
      const { prefix, threadId } = syncedThreadId(input.source.sourceId, thread, projectId);
      const localManagement = input.localThreadManagement?.get(syncedThreadKey(threadId));
      if (localManagement?.deleted) continue;
      const existingVersion = input.threads.find((candidate) => candidate.id === threadId);
      for (const previous of input.threads) {
        if (
          previous.id.startsWith(prefix) &&
          previous.id !== threadId &&
          previous.deletedAt === null
        ) {
          steps.push({ type: "thread.visibility", threadId: previous.id, visible: false });
          hidden.push(previous.id);
        }
      }
      if (existingVersion?.deletedAt === null) continue;
      steps.push(
        existingVersion
          ? { type: "thread.visibility", threadId, visible: true }
          : { type: "thread.import", threadId, projectId, thread },
      );
      steps.push(...planThreadManagement(threadId, existingVersion, localManagement));
      visible.push(threadId);
    }
  }
  return {
    steps,
    record: {
      id: input.batchId,
      sourceId: input.source.sourceId,
      sourceHome: input.source.sourceHome,
      createdAt: input.now,
      contentHash: input.source.contentHash,
      parentId: activeSyncRecord(input.history)?.id ?? null,
      undoBatchId: null,
      mappings: input.mappings,
      visibleThreadIds: visible,
      hiddenThreadIds: hidden,
      projectChanges: changes,
    },
  };
}

/**
 * Reverts the active batch: hides what it showed, restores what it hid, and puts back
 * project settings nobody has changed since. A project it created goes only when
 * nothing else lives in it and its settings are untouched.
 */
export function planUndo(input: {
  active: ProjectSyncRecord;
  projects: ReadonlyArray<ProjectSyncProjectSnapshot>;
  threads: ReadonlyArray<SyncedThreadState>;
  /** Live threads that are not imported versions, by project. */
  localThreadProjects: ReadonlySet<ProjectId>;
  localSettingOverrides: ReadonlyMap<ProjectId, ReadonlySet<string>>;
  localThreadManagement: ReadonlyMap<string, SyncedThreadManagement>;
  batchId: string;
  now: string;
  schedule: NonNullable<ProjectSyncRecord["schedule"]>;
}): SyncPlan {
  const { active } = input;
  const restoredThreadIds = active.hiddenThreadIds.filter(
    (threadId) => !input.localThreadManagement.get(syncedThreadKey(threadId))?.deleted,
  );
  const steps: SyncStep[] = [
    ...active.visibleThreadIds.map((threadId): SyncStep => ({
      type: "thread.visibility",
      threadId,
      visible: false,
    })),
    ...restoredThreadIds.map((threadId): SyncStep => ({
      type: "thread.visibility",
      threadId,
      visible: true,
    })),
  ];
  for (const threadId of restoredThreadIds) {
    steps.push(
      ...planThreadManagement(
        threadId,
        input.threads.find((thread) => thread.id === threadId),
        input.localThreadManagement.get(syncedThreadKey(threadId)),
      ),
    );
  }
  for (const change of active.projectChanges) {
    const current = input.projects.find(
      (project) => project.id === change.after.id && !project.deletedAt,
    );
    if (!current) continue;
    const overrides = input.localSettingOverrides.get(current.id);
    const canRestore = (key: keyof ProjectSettings) =>
      !overrides?.has(key) &&
      contentHash(projectSettings(current)[key]) ===
        contentHash(projectSettings(change.after)[key]);
    if (change.before === null) {
      if (
        !input.localThreadProjects.has(current.id) &&
        overrides === undefined &&
        contentHash(projectSettings(current)) === contentHash(projectSettings(change.after))
      ) {
        steps.push({ type: "project.delete", projectId: current.id });
      }
      continue;
    }
    const before = projectSettings(change.before);
    const settings: Partial<ProjectSettings> = {};
    for (const key of settingsKeys) {
      if (canRestore(key)) Object.assign(settings, { [key]: before[key] });
    }
    if (Object.keys(settings).length > 0)
      steps.push({ type: "project.update", projectId: current.id, settings });
  }
  return {
    steps,
    record: {
      ...active,
      id: input.batchId,
      createdAt: input.now,
      parentId: active.parentId,
      undoBatchId: active.id,
      schedule: input.schedule,
      visibleThreadIds: restoredThreadIds,
      hiddenThreadIds: active.visibleThreadIds,
      projectChanges: [],
    },
  };
}
