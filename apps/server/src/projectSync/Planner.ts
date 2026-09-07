import {
  CommandId,
  MessageId,
  ThreadId,
  ProjectId,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type ProjectSyncApplyCommand,
  type ProjectSyncMapping,
  type ProjectSyncRecord,
} from "@t3tools/contracts";
import { contentHash, type SyncSource } from "./Source.ts";
import { EventId } from "@t3tools/contracts";

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

const settingsKeys = [
  "title",
  "defaultModelSelection",
  "defaultThreadEnvMode",
  "autoPull",
  "projectIcon",
  "scripts",
] as const;
export function projectSettings(project: OrchestrationProject) {
  return {
    title: project.title,
    defaultModelSelection: project.defaultModelSelection,
    defaultThreadEnvMode: project.defaultThreadEnvMode ?? null,
    autoPull: project.autoPull ?? false,
    projectIcon: project.projectIcon ?? null,
    scripts: project.scripts,
  };
}

export function planImport(input: {
  source: SyncSource;
  snapshot: OrchestrationReadModel;
  history: ReadonlyArray<ProjectSyncRecord>;
  mappings: ReadonlyArray<ProjectSyncMapping>;
  batchId: string;
  now: string;
  localSettingOverrides?: ReadonlyMap<ProjectId, ReadonlySet<string>>;
}): ProjectSyncApplyCommand {
  const plan: ProjectSyncApplyCommand = {
    type: "project.sync.apply",
    commandId: CommandId.make(input.batchId),
    projectId: ProjectId.make(`sync-${input.source.sourceId}`),
    expectedSequence: input.snapshot.snapshotSequence,
    commands: [],
    record: {
      id: input.batchId,
      sourceId: input.source.sourceId,
      sourceHome: input.source.sourceHome,
      createdAt: input.now,
      contentHash: input.source.contentHash,
      parentId: activeSyncRecord(input.history)?.id ?? null,
      undoBatchId: null,
      mappings: input.mappings,
      visibleThreadIds: [],
      hiddenThreadIds: [],
      projectChanges: [],
    },
  };
  const commands: ProjectSyncApplyCommand["commands"][number][] = [];
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
    const existing = input.snapshot.projects.find((project) => project.id === projectId);
    if (existing?.deletedAt)
      throw new Error(
        `The mapped project ${existing.title} has been deleted. Choose a new destination.`,
      );
    if (!existing) {
      const after = { ...entry.project, id: projectId };
      commands.push({
        type: "project.create",
        commandId: plan.commandId,
        projectId,
        title: after.title,
        workspaceRoot: after.workspaceRoot,
        createdAt: after.createdAt,
      });
      commands.push({
        type: "project.meta.update",
        commandId: plan.commandId,
        projectId,
        ...projectSettings(after),
      });
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
          commands.push({
            type: "project.meta.update",
            commandId: plan.commandId,
            projectId,
            ...merged,
          });
          changes.push({
            before: existing,
            after: { ...existing, ...merged, updatedAt: input.now },
            ownedSettings,
          });
        }
      }
    }
    for (const thread of entry.threads) {
      const prefix = `t3sync-${input.source.sourceId.slice(0, 12)}-${contentHash(thread.id).slice(0, 12)}-`;
      const threadId = ThreadId.make(`${prefix}${contentHash({ thread, projectId }).slice(0, 20)}`);
      const existingVersion = input.snapshot.threads.find((candidate) => candidate.id === threadId);
      for (const previous of input.snapshot.threads) {
        if (
          previous.id.startsWith(prefix) &&
          previous.id !== threadId &&
          previous.deletedAt === null
        ) {
          commands.push({
            type: "thread.sync.visibility",
            commandId: plan.commandId,
            threadId: previous.id,
            deletedAt: input.now,
            updatedAt: input.now,
          });
          hidden.push(previous.id);
        }
      }
      if (existingVersion?.deletedAt === null) continue;
      if (existingVersion) {
        commands.push({
          type: "thread.sync.visibility",
          commandId: plan.commandId,
          threadId,
          deletedAt: null,
          updatedAt: input.now,
        });
      } else {
        commands.push({
          type: "thread.create",
          commandId: plan.commandId,
          threadId,
          projectId,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          branch: thread.branch,
          worktreePath: null,
          createdAt: thread.createdAt,
          historyImport: true,
        });
        if (thread.messages.length > 0)
          commands.push({
            type: "thread.history.import",
            commandId: plan.commandId,
            threadId,
            messages: thread.messages.map((message) => ({
              messageId: MessageId.make(`${threadId}-${contentHash(message.id).slice(0, 16)}`),
              role: message.role,
              text: message.text,
              createdAt: message.createdAt,
              ...(message.attachments ? { attachments: message.attachments } : {}),
            })),
          });
      }
      if (!existingVersion) {
        for (const activity of thread.activities)
          commands.push({
            type: "thread.activity.append",
            commandId: plan.commandId,
            threadId,
            createdAt: activity.createdAt,
            activity: {
              ...activity,
              id: EventId.make(`${threadId}-${contentHash(activity.id).slice(0, 16)}`),
            },
          });
        if (thread.archivedAt)
          commands.push({ type: "thread.archive", commandId: plan.commandId, threadId });
      }
      visible.push(threadId);
    }
  }
  return {
    ...plan,
    commands,
    record: {
      ...plan.record,
      projectChanges: changes,
      visibleThreadIds: visible,
      hiddenThreadIds: hidden,
    },
  };
}
