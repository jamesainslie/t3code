// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  CommandId,
  MessageId,
  EventId,
  ProjectId,
  ThreadId,
  ProjectSyncConfiguration,
  ProjectSyncError,
  ProjectSyncRecord,
  isSyncedThreadId,
  type ProjectSyncRequest,
  type ProjectSyncResponse,
  type ProjectSyncApplyCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as EffectPath from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { readSyncSource, contentHash } from "./Source.ts";
import { inspectSyncAssets, stageSyncSource } from "./Assets.ts";
import { isSyncDue } from "./scheduleDue.ts";
import {
  activeSyncRecord,
  planImport,
  projectSettings,
  syncedThreadKey,
  planThreadManagement,
  type SyncedThreadManagement,
} from "./Planner.ts";
import {
  cancelRecoveryRestore,
  createRecoveryBackup,
  listRecoveryBackups,
  prepareRecoveryRestore,
  recoveryPending,
} from "./Recovery.ts";

const error = (cause: unknown) =>
  new ProjectSyncError({ message: cause instanceof Error ? cause.message : String(cause) });
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: error });
const decodeConfiguration = Schema.decodeUnknownSync(
  Schema.fromJsonString(ProjectSyncConfiguration),
);
const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(ProjectSyncRecord));
const decodePayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export class ProjectSyncService extends Context.Service<
  ProjectSyncService,
  {
    readonly execute: (
      request: ProjectSyncRequest | { operation: "scheduled" },
    ) => Effect.Effect<ProjectSyncResponse, ProjectSyncError>;
  }
>()("t3/projectSync/Service/ProjectSyncService") {
  static readonly layer = Layer.effect(
    ProjectSyncService,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const sql = yield* SqlClient.SqlClient;
      const engine = yield* OrchestrationEngineService;
      const snapshots = yield* ProjectionSnapshotQuery;
      const mutex = yield* Semaphore.make(1);
      const fileSystem = yield* FileSystem.FileSystem;
      const effectPath = yield* EffectPath.Path;
      const configurationPath = NodePath.join(config.stateDir, "project-sync.json");
      const defaultSourceHome = NodePath.join(NodeOS.homedir(), ".t3");
      const defaults: ProjectSyncConfiguration = {
        sourceHome: null,
        sourceId: null,
        enabled: false,
        hour: 3,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        mappings: [],
      };
      const readConfigurationFile = attempt(async () => {
        try {
          return decodeConfiguration(await NodeFSP.readFile(configurationPath, "utf8"));
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return defaults;
          throw cause;
        }
      });
      const saveConfiguration = (value: ProjectSyncConfiguration) =>
        writeFileStringAtomically({
          filePath: configurationPath,
          contents: JSON.stringify(value),
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(EffectPath.Path, effectPath),
        );
      const readHistory = Effect.gen(function* () {
        const rows = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM orchestration_events WHERE event_type = 'project.sync-recorded' ORDER BY sequence DESC`;
        return rows
          .map((row) => decodeRecord(row.payload_json))
          .filter((record) => record.sourceId !== "continuation");
      });
      const readConfiguration = Effect.gen(function* () {
        const configuration = yield* readConfigurationFile;
        const history = yield* readHistory;
        const latest = history[0];
        if (!latest || configuration.lastJournalId === latest.id) return configuration;
        const active = activeSyncRecord(history);
        const recovered: ProjectSyncConfiguration = {
          ...configuration,
          sourceHome: latest.sourceHome,
          sourceId: latest.sourceId,
          ...latest.schedule,
          enabled: latest.undoBatchId ? false : (latest.schedule?.enabled ?? false),
          mappings: active?.mappings ?? [],
          lastJournalId: latest.id,
          lastSuccessAt: latest.createdAt,
          lastError: null,
        };
        yield* saveConfiguration(recovered);
        return recovered;
      });
      const status = Effect.gen(function* () {
        const configuration = yield* readConfiguration;
        const history = yield* readHistory;
        return {
          configuration,
          history,
          activeBatchId: activeSyncRecord(history)?.id ?? null,
          defaultSourceHome,
          backups: yield* attempt(() => listRecoveryBackups(config.stateDir)),
          restorePending: yield* attempt(() => recoveryPending(config.stateDir)),
        } satisfies ProjectSyncResponse;
      });
      const localOverrides = Effect.fn("ProjectSync.localOverrides")(function* (
        afterBatchId: string | null = null,
      ) {
        const rows = yield* sql<{ stream_id: string; payload_json: string }>`
        SELECT stream_id, payload_json FROM orchestration_events
        WHERE event_type = 'project.meta-updated' AND COALESCE(json_extract(metadata_json, '$.historyImport'), 0) = 0
        AND sequence > COALESCE((SELECT sequence FROM orchestration_events WHERE event_type = 'project.sync-recorded' AND json_extract(payload_json, '$.id') = ${afterBatchId}), 0)`;
        const overrides = new Map<ProjectId, Set<string>>();
        for (const row of rows) {
          const projectId = ProjectId.make(row.stream_id);
          const keys = overrides.get(projectId) ?? new Set<string>();
          const payload = decodePayload(row.payload_json);
          for (const key of Object.keys(payload)) keys.add(key);
          overrides.set(projectId, keys);
        }
        return overrides;
      });
      const localThreadManagement = Effect.gen(function* () {
        const rows = yield* sql<{ stream_id: string; event_type: string }>`
          SELECT stream_id, event_type FROM orchestration_events
          WHERE event_type IN ('thread.deleted', 'thread.archived', 'thread.unarchived', 'thread.settled', 'thread.unsettled')
          AND stream_id LIKE 't3sync-%'
          AND COALESCE(json_extract(metadata_json, '$.historyImport'), 0) = 0
          ORDER BY sequence ASC`;
        const overrides = new Map<string, SyncedThreadManagement>();
        for (const row of rows) {
          const key = syncedThreadKey(row.stream_id);
          const local = overrides.get(key) ?? {};
          switch (row.event_type) {
            case "thread.deleted":
              local.deleted = true;
              break;
            case "thread.archived":
              local.archived = true;
              break;
            case "thread.unarchived":
              local.archived = false;
              break;
            case "thread.settled":
              local.settledOverride = "settled";
              break;
            case "thread.unsettled":
              local.settledOverride = "active";
              break;
          }
          overrides.set(key, local);
        }
        return overrides;
      });
      const loadSource = Effect.fn("ProjectSync.loadSource")(function* (home: string) {
        const source = yield* attempt(() => readSyncSource(home));
        const destination = yield* attempt(() => NodeFSP.realpath(config.baseDir));
        if (source.sourceHome === destination)
          return yield* new ProjectSyncError({
            message: "The source must be a different T3 install.",
          });
        const [from, to] = yield* attempt(() =>
          Promise.all([
            NodeFSP.stat(NodePath.join(source.sourceHome, "userdata/state.sqlite")),
            NodeFSP.stat(NodePath.join(config.stateDir, "state.sqlite")),
          ]),
        );
        if (from.dev === to.dev && from.ino === to.ino)
          return yield* new ProjectSyncError({
            message: "The source and destination share the same database.",
          });
        return source;
      });
      const executeUnlocked = Effect.fn("ProjectSync.execute")(function* (
        request: ProjectSyncRequest | { operation: "scheduled" },
      ) {
        let configuration = yield* readConfiguration;
        const history = yield* readHistory;
        const now = DateTime.formatIso(yield* DateTime.now);
        if (request.operation === "status") return yield* status;
        if (
          request.operation === "scheduled" &&
          (!isSyncDue(configuration, now) ||
            (yield* attempt(() => recoveryPending(config.stateDir))))
        )
          return yield* status;
        if (request.operation === "cancelRestore") {
          yield* attempt(() => cancelRecoveryRestore(config.stateDir));
          return yield* status;
        }
        if (request.operation === "configure") {
          if (request.enabled && !configuration.sourceHome)
            return yield* new ProjectSyncError({
              message: "Import a source before enabling nightly sync.",
            });
          yield* saveConfiguration({
            ...configuration,
            enabled: request.enabled,
            hour: request.hour,
          });
          return yield* status;
        }
        if (request.operation === "prepareRestore") {
          yield* saveConfiguration({ ...configuration, enabled: false });
          yield* attempt(() => prepareRecoveryRestore(config.stateDir, request.backupId));
          return yield* status;
        }
        if (yield* attempt(() => recoveryPending(config.stateDir)))
          return yield* new ProjectSyncError({
            message:
              "A recovery restore is prepared. Restart this environment before importing more work.",
          });
        if (request.operation === "preview") {
          const source = yield* loadSource(
            request.sourceHome ?? configuration.sourceHome ?? defaultSourceHome,
          );
          const assetWarnings = yield* attempt(() => inspectSyncAssets(source));
          const snapshot = yield* snapshots.getSnapshot();
          return {
            ...(yield* status),
            preview: {
              sourceHome: source.sourceHome,
              sourceId: source.sourceId,
              contentHash: source.contentHash,
              projects: source.projects.map((entry) => {
                const known =
                  configuration.sourceId === source.sourceId
                    ? configuration.mappings.find(
                        (mapping) => mapping.sourceProjectId === entry.project.id,
                      )
                    : undefined;
                const existing = snapshot.projects.find(
                  (project) =>
                    project.deletedAt === null &&
                    (known?.projectId
                      ? project.id === known.projectId
                      : project.workspaceRoot === entry.project.workspaceRoot),
                );
                const unsupported = entry.warnings.some((warning) =>
                  warning.includes("remote host"),
                );
                return {
                  sourceProjectId: entry.project.id,
                  title: entry.project.title,
                  workspaceRoot: entry.project.workspaceRoot,
                  threadCount: entry.threads.length,
                  projectId:
                    unsupported || known?.projectId === null
                      ? null
                      : (existing?.id ?? ProjectId.make(NodeCrypto.randomUUID())),
                  existing: existing !== undefined,
                  warnings: [...entry.warnings, ...(assetWarnings.get(entry.project.id) ?? [])],
                };
              }),
            },
          } satisfies ProjectSyncResponse;
        }
        if (request.operation === "continue") {
          if (!isSyncedThreadId(request.threadId))
            return yield* new ProjectSyncError({
              message: "Choose an imported conversation to continue.",
            });
          const snapshot = yield* snapshots.getSnapshot();
          const thread = Option.fromNullishOr(
            snapshot.threads.find(
              (candidate) => candidate.id === request.threadId && candidate.deletedAt === null,
            ),
          );
          if (Option.isNone(thread))
            return yield* new ProjectSyncError({
              message: "This imported conversation is no longer visible. Open its current version.",
            });
          const threadId = ThreadId.make(`t3continue-${NodeCrypto.randomUUID()}`);
          const commandId = CommandId.make(NodeCrypto.randomUUID());
          const commands: ProjectSyncApplyCommand["commands"][number][] = [
            {
              type: "thread.create",
              commandId,
              threadId,
              projectId: thread.value.projectId,
              title: thread.value.title,
              modelSelection: thread.value.modelSelection,
              runtimeMode: thread.value.runtimeMode,
              interactionMode: thread.value.interactionMode,
              branch: thread.value.branch,
              worktreePath: null,
              createdAt: now,
              historyImport: true,
            },
          ];
          if (thread.value.messages.length)
            commands.push({
              type: "thread.history.import",
              commandId,
              threadId,
              messages: thread.value.messages.map((message, index) => ({
                messageId: MessageId.make(`${threadId}-${index}`),
                role: message.role,
                text: message.text,
                createdAt: message.createdAt,
                ...(message.attachments ? { attachments: message.attachments } : {}),
              })),
            });
          for (const activity of thread.value.activities)
            commands.push({
              type: "thread.activity.append",
              commandId,
              threadId,
              createdAt: activity.createdAt,
              activity: {
                ...activity,
                id: EventId.make(`${threadId}-${contentHash(activity.id).slice(0, 16)}`),
              },
            });
          yield* engine.dispatch({
            type: "project.sync.apply",
            commandId,
            projectId: thread.value.projectId,
            expectedSequence: snapshot.snapshotSequence,
            commands,
            record: {
              id: commandId,
              sourceId: "continuation",
              sourceHome: request.threadId,
              createdAt: now,
              parentId: activeSyncRecord(history)?.id ?? null,
              undoBatchId: null,
              contentHash: contentHash(threadId),
              mappings: [],
              projectChanges: [],
              visibleThreadIds: [],
              hiddenThreadIds: [],
            },
          });
          return { ...(yield* status), threadId };
        }
        if (request.operation === "undo") {
          const active = activeSyncRecord(history);
          if (!active || active.id !== request.batchId)
            return yield* new ProjectSyncError({
              message: "Only the latest active sync can be undone. Refresh sync history.",
            });
          yield* saveConfiguration({ ...configuration, enabled: false });
          const snapshot = yield* snapshots.getSnapshot();
          const overrides = yield* localOverrides(active.id);
          const threadManagement = yield* localThreadManagement;
          const restoredThreadIds = active.hiddenThreadIds.filter(
            (threadId) => !threadManagement.get(syncedThreadKey(threadId))?.deleted,
          );
          const commandId = CommandId.make(NodeCrypto.randomUUID());
          const commands: ProjectSyncApplyCommand["commands"][number][] = [
            ...active.visibleThreadIds.map((threadId) => ({
              type: "thread.sync.visibility" as const,
              commandId,
              threadId,
              deletedAt: now,
              updatedAt: now,
            })),
            ...restoredThreadIds.map((threadId) => ({
              type: "thread.sync.visibility" as const,
              commandId,
              threadId,
              deletedAt: null,
              updatedAt: now,
            })),
          ];
          for (const threadId of restoredThreadIds) {
            commands.push(
              ...planThreadManagement(
                commandId,
                threadId,
                snapshot.threads.find((thread) => thread.id === threadId),
                threadManagement.get(syncedThreadKey(threadId)),
              ),
            );
          }
          for (const change of active.projectChanges) {
            const current = snapshot.projects.find(
              (project) => project.id === change.after.id && project.deletedAt === null,
            );
            if (!current) continue;
            const canRestore = (key: keyof ReturnType<typeof projectSettings>) =>
              !overrides.get(current.id)?.has(key) &&
              contentHash(projectSettings(current)[key]) ===
                contentHash(projectSettings(change.after)[key]);
            if (change.before === null) {
              const localThreads = snapshot.threads.some(
                (thread) =>
                  thread.projectId === current.id &&
                  thread.deletedAt === null &&
                  !active.visibleThreadIds.includes(thread.id),
              );
              if (
                !localThreads &&
                !overrides.has(current.id) &&
                contentHash(projectSettings(current)) === contentHash(projectSettings(change.after))
              ) {
                commands.push({ type: "project.delete", commandId, projectId: current.id });
              }
            } else {
              const before = change.before;
              commands.push({
                type: "project.meta.update",
                commandId,
                projectId: current.id,
                ...(canRestore("title") ? { title: before.title } : {}),
                ...(canRestore("scripts") ? { scripts: before.scripts } : {}),
                ...(canRestore("defaultModelSelection")
                  ? { defaultModelSelection: before.defaultModelSelection }
                  : {}),
                ...(canRestore("defaultThreadEnvMode")
                  ? { defaultThreadEnvMode: before.defaultThreadEnvMode ?? null }
                  : {}),
                ...(canRestore("autoPull") ? { autoPull: before.autoPull ?? false } : {}),
                ...(canRestore("projectIcon") ? { projectIcon: before.projectIcon ?? null } : {}),
              });
            }
          }
          yield* engine.dispatch({
            type: "project.sync.apply",
            commandId,
            projectId: ProjectId.make(`sync-${active.sourceId}`),
            expectedSequence: snapshot.snapshotSequence,
            commands,
            record: {
              ...active,
              id: commandId,
              createdAt: now,
              undoBatchId: active.id,
              schedule: {
                enabled: false,
                hour: configuration.hour,
                timezone: configuration.timezone,
              },
              visibleThreadIds: restoredThreadIds,
              hiddenThreadIds: active.visibleThreadIds,
              projectChanges: [],
            },
          });
          const parent = history.find((record) => record.id === active.parentId);
          yield* saveConfiguration({
            ...configuration,
            enabled: false,
            mappings: parent?.mappings ?? [],
            lastJournalId: commandId,
          });
          return yield* status;
        }
        const sourceHome =
          request.operation === "import" ? request.sourceHome : configuration.sourceHome;
        if (!sourceHome)
          return yield* new ProjectSyncError({ message: "Set up a source install first." });
        configuration = { ...configuration, lastAttemptAt: now, lastError: null };
        yield* saveConfiguration(configuration);
        const source = yield* loadSource(sourceHome);
        if (request.operation === "import" && request.contentHash !== source.contentHash)
          return yield* new ProjectSyncError({
            message: "The source changed since the preview. Preview again before importing.",
          });
        if (
          configuration.sourceId !== null &&
          configuration.sourceId !== source.sourceId &&
          activeSyncRecord(history)
        )
          return yield* new ProjectSyncError({
            message:
              "This is a different source install. Keep the current source or undo its imports before changing sources.",
          });
        const snapshot = yield* snapshots.getSnapshot();
        const mappings =
          request.operation === "import"
            ? request.mappings
            : source.projects.map(
                (entry) =>
                  configuration.mappings.find(
                    (mapping) => mapping.sourceProjectId === entry.project.id,
                  ) ?? {
                    sourceProjectId: entry.project.id,
                    projectId: entry.warnings.some((warning) => warning.includes("remote host"))
                      ? null
                      : (snapshot.projects.find(
                          (project) =>
                            project.deletedAt === null &&
                            project.workspaceRoot === entry.project.workspaceRoot,
                        )?.id ?? ProjectId.make(NodeCrypto.randomUUID())),
                  },
              );
        const staged = yield* attempt(() =>
          stageSyncSource(source, config.attachmentsDir, mappings),
        );
        const batchId = NodeCrypto.randomUUID();
        const schedule = {
          enabled: request.operation === "import" ? request.nightly : configuration.enabled,
          hour: configuration.hour,
          timezone: configuration.timezone,
        };
        const preparePlan = Effect.gen(function* () {
          const snapshot = yield* snapshots.getSnapshot();
          const planned = planImport({
            source: staged,
            snapshot,
            history,
            mappings,
            batchId,
            now,
            localSettingOverrides: yield* localOverrides(),
            localThreadManagement: yield* localThreadManagement,
          });
          return { ...planned, record: { ...planned.record, schedule } };
        });
        let plan = yield* preparePlan;
        const publish = plan.commands.length > 0 || request.operation === "import";
        if (publish) {
          yield* attempt(() => createRecoveryBackup(config.stateDir, now));
          plan = yield* preparePlan;
          yield* engine.dispatch(plan);
        }
        yield* saveConfiguration({
          ...configuration,
          sourceHome: source.sourceHome,
          sourceId: source.sourceId,
          mappings,
          enabled: request.operation === "import" ? request.nightly : configuration.enabled,
          ...(publish ? { lastJournalId: plan.record.id } : {}),
          lastSuccessAt: now,
          lastError: null,
        });
        return yield* status;
      });
      return ProjectSyncService.of({
        execute: (request) =>
          mutex.withPermits(1)(
            executeUnlocked(request).pipe(
              Effect.mapError(error),
              Effect.tapError((failure) =>
                Effect.gen(function* () {
                  if (request.operation === "status" || request.operation === "preview") return;
                  const current = yield* readConfiguration;
                  yield* saveConfiguration({ ...current, lastError: failure.message });
                }).pipe(Effect.catch(() => Effect.void)),
              ),
            ),
          ),
      });
    }),
  );
}
