// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  ProjectId,
  ThreadId,
  ProjectSyncConfiguration,
  ProjectSyncError,
  type ProjectSyncProjectSnapshot,
  type ProjectSyncRequest,
  type ProjectSyncResponse,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as EffectPath from "effect/Path";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { writeFileStringAtomically } from "../atomicWrite.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import { ProjectService } from "../project/ProjectService.ts";
import { readSyncSource, sourceDatabasePath } from "./Source.ts";
import { inspectSyncAssets, stageSyncSource } from "./Assets.ts";
import { isSyncDue } from "./scheduleDue.ts";
import { applySyncPlan, continueSyncedThread, SYNC_COMMAND_PREFIX } from "./Apply.ts";
import {
  activeSyncRecord,
  planImport,
  planUndo,
  syncedThreadKey,
  type SyncedThreadManagement,
  type SyncedThreadState,
} from "./Planner.ts";
import { readSyncHistory, syncRecordHighWater } from "./Records.ts";
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
const decodePayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/** Local edits: not written by a v1 history import, and not by a sync batch. */
const LOCAL_EVENT_FILTER = `COALESCE(json_extract(metadata_json, '$.historyImport'), 0) = 0
  AND COALESCE(command_id, '') NOT LIKE '${SYNC_COMMAND_PREFIX}%'`;

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
      const projectService = yield* ProjectService;
      const projectStore = yield* ProjectStore.ProjectStoreV2;
      const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
      const eventSink = yield* EventSink.EventSinkV2;
      const mutex = yield* Semaphore.make(1);
      const fileSystem = yield* FileSystem.FileSystem;
      const effectPath = yield* EffectPath.Path;
      const provideWriters = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(ProjectService, projectService),
          Effect.provideService(ProjectionStore.ProjectionStoreV2, projectionStore),
          Effect.provideService(EventSink.EventSinkV2, eventSink),
        );
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
      const readHistory = readSyncHistory.pipe(Effect.provideService(SqlClient.SqlClient, sql));
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
      const listProjects = projectStore.list({ includeDeleted: true }).pipe(
        Effect.map((rows) =>
          rows.map((row): ProjectSyncProjectSnapshot => ({
            id: row.projectId,
            title: row.title,
            workspaceRoot: row.workspaceRoot,
            repositoryIdentity: null,
            defaultModelSelection: row.defaultModelSelection,
            defaultThreadEnvMode: row.defaultThreadEnvMode,
            autoPull: row.autoPull,
            faviconPath: row.faviconPath,
            projectIcon: row.projectIcon,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          })),
        ),
      );
      const listSyncedThreads = sql<{
        thread_id: string;
        project_id: string;
        deleted_at: string | null;
        archived_at: string | null;
        settled_override: string | null;
      }>`
        SELECT
          thread_id,
          project_id,
          deleted_at,
          archived_at,
          json_extract(payload_json, '$.settledOverride') AS settled_override
        FROM orchestration_v2_projection_threads
        WHERE thread_id LIKE 't3sync-%'
      `.pipe(
        Effect.map((rows) =>
          rows.map((row): SyncedThreadState => ({
            id: ThreadId.make(row.thread_id),
            projectId: ProjectId.make(row.project_id),
            deletedAt: row.deleted_at,
            archivedAt: row.archived_at,
            settledOverride:
              row.settled_override === "settled" || row.settled_override === "active"
                ? row.settled_override
                : null,
          })),
        ),
      );
      const localOverrides = Effect.fn("ProjectSync.localOverrides")(function* (
        afterBatchId: string | null = null,
      ) {
        const after =
          afterBatchId === null
            ? 0
            : yield* syncRecordHighWater(afterBatchId).pipe(
                Effect.provideService(SqlClient.SqlClient, sql),
              );
        const rows = yield* sql<{ stream_id: string; payload_json: string }>`
          SELECT stream_id, payload_json FROM orchestration_events
          WHERE event_type = 'project.meta-updated'
          AND ${sql.unsafe(LOCAL_EVENT_FILTER)}
          AND sequence > ${after}`;
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
          AND ${sql.unsafe(LOCAL_EVENT_FILTER)}
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
        const [from, to] = yield* attempt(async () =>
          Promise.all([
            NodeFSP.stat(await sourceDatabasePath(source.sourceHome)),
            NodeFSP.stat(config.dbPath),
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
          const projects = yield* listProjects;
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
                const existing = projects.find(
                  (project) =>
                    !project.deletedAt &&
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
          const threadId = yield* provideWriters(
            continueSyncedThread(
              request.threadId,
              ThreadId.make(`t3continue-${NodeCrypto.randomUUID()}`),
            ),
          );
          return { ...(yield* status), threadId };
        }
        if (request.operation === "undo") {
          const active = activeSyncRecord(history);
          if (!active || active.id !== request.batchId)
            return yield* new ProjectSyncError({
              message: "Only the latest active sync can be undone. Refresh sync history.",
            });
          yield* saveConfiguration({ ...configuration, enabled: false });
          const hidden = new Set<string>(active.visibleThreadIds);
          const liveThreads = yield* sql<{ thread_id: string; project_id: string }>`
            SELECT thread_id, project_id FROM orchestration_v2_projection_threads
            WHERE deleted_at IS NULL`;
          const plan = planUndo({
            active,
            projects: yield* listProjects,
            threads: yield* listSyncedThreads,
            localThreadProjects: new Set(
              liveThreads
                .filter((thread) => !hidden.has(thread.thread_id))
                .map((thread) => ProjectId.make(thread.project_id)),
            ),
            localSettingOverrides: yield* localOverrides(active.id),
            localThreadManagement: yield* localThreadManagement,
            batchId: NodeCrypto.randomUUID(),
            now,
            schedule: {
              enabled: false,
              hour: configuration.hour,
              timezone: configuration.timezone,
            },
          });
          yield* provideWriters(applySyncPlan(plan));
          const parent = history.find((record) => record.id === active.parentId);
          yield* saveConfiguration({
            ...configuration,
            enabled: false,
            mappings: parent?.mappings ?? [],
            lastJournalId: plan.record.id,
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
        const currentProjects = yield* listProjects;
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
                      : (currentProjects.find(
                          (project) =>
                            !project.deletedAt &&
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
          const projects = yield* listProjects;
          const threads = yield* listSyncedThreads;
          const localSettingOverrides = yield* localOverrides();
          const management = yield* localThreadManagement;
          const planned = yield* Effect.try({
            try: () =>
              planImport({
                source: staged,
                projects,
                threads,
                history,
                mappings,
                batchId,
                now,
                localSettingOverrides,
                localThreadManagement: management,
              }),
            catch: error,
          });
          return { ...planned, record: { ...planned.record, schedule } };
        });
        let plan = yield* preparePlan;
        const publish = plan.steps.length > 0 || request.operation === "import";
        if (publish) {
          yield* attempt(() => createRecoveryBackup(config.stateDir, now));
          plan = yield* preparePlan;
          yield* provideWriters(applySyncPlan(plan));
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
              Effect.provideService(SqlClient.SqlClient, sql),
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
