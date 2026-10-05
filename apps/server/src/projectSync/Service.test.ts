// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { ServerConfig } from "../config.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import {
  OrchestrationV2EventSinkLayerLive,
  ProjectServiceLayerLive,
} from "../orchestration-v2/runtimeLayer.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "../project/ProjectFaviconResolver.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { importThreadEvents, manageThread } from "./Apply.ts";
import type { SyncStep } from "./Planner.ts";
import { ProjectSyncService } from "./Service.ts";
import type { SyncThread } from "./Source.ts";

const at = "2026-09-07T00:00:00.000Z";

const environmentLayer = (home: string) =>
  Layer.mergeAll(
    Layer.succeed(WorkspacePaths.WorkspacePaths, {
      normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot),
      resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
        Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
    }),
    Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
      resolve: () => Effect.succeed(null),
    }),
    Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
      resolvePath: () => Effect.succeed(null),
    }),
  ).pipe(
    Layer.provideMerge(makeSqlitePersistenceLive(NodePath.join(home, "userdata/statev2.sqlite"))),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), home)),
    Layer.provideMerge(NodeServices.layer),
  );

const runtimeLayer = (home: string) =>
  ProjectSyncService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ProjectServiceLayerLive,
        OrchestrationV2EventSinkLayerLive,
        ProjectStore.layer,
        ProjectionStore.layer,
      ),
    ),
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(environmentLayer(home)),
  );

type Services =
  | ProjectSyncService
  | ProjectService
  | EventSink.EventSinkV2
  | ProjectionStore.ProjectionStoreV2;

const runtime = Effect.fn(function* (home: string) {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(runtimeLayer(home), scope);
  return {
    run: <A, E>(effect: Effect.Effect<A, E, Services>) => Effect.provide(effect, context),
    sync: <A, E>(f: (service: ProjectSyncService["Service"]) => Effect.Effect<A, E>) =>
      Effect.provide(Effect.flatMap(ProjectSyncService, f), context),
    dispose: () => Scope.close(scope, Exit.void),
  };
});
type Runtime = Effect.Success<ReturnType<typeof runtime>>;

const thread = (id: string, title: string, messages: SyncThread["messages"]): SyncThread => ({
  id: ThreadId.make(id),
  title,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  createdAt: at,
  updatedAt: at,
  messages,
  activities: [],
});

const createProject = (target: Runtime, projectId: string, workspaceRoot: string, title: string) =>
  target.run(
    Effect.flatMap(ProjectService, (projects) =>
      projects.create({
        commandId: CommandId.make(`create-${projectId}`),
        projectId: ProjectId.make(projectId),
        title,
        workspaceRoot,
      }),
    ),
  );

const createThread = (target: Runtime, projectId: string, source: SyncThread) =>
  target.run(
    Effect.flatMap(EventSink.EventSinkV2, (sink) =>
      sink.write({ events: importThreadEvents(source.id, ProjectId.make(projectId), source) }),
    ),
  );

const getThread = (target: Runtime, threadId: ThreadId) =>
  target.run(Effect.flatMap(ProjectionStore.ProjectionStoreV2, (s) => s.getThread(threadId)));

const getMessages = (target: Runtime, threadId: ThreadId) =>
  target
    .run(
      Effect.flatMap(ProjectionStore.ProjectionStoreV2, (s) =>
        s.getThreadRecords(threadId, ["messages"]),
      ),
    )
    .pipe(Effect.map((records) => records.messages));

const renameThread = (target: Runtime, threadId: ThreadId, title: string) =>
  Effect.gen(function* () {
    const current = yield* getThread(target, threadId);
    yield* target.run(
      Effect.flatMap(EventSink.EventSinkV2, (sink) =>
        sink.write({
          events: [
            {
              id: EventId.make(`rename-${title}`),
              type: "thread.metadata-updated",
              threadId,
              providerInstanceId: current.providerInstanceId,
              occurredAt: DateTime.makeUnsafe(at),
              payload: { ...current, title },
            },
          ],
        }),
      ),
    );
  });

/** A user's organization edit, written like the orchestrator would write it. */
const localAction = (
  target: Runtime,
  threadId: ThreadId,
  type: Exclude<SyncStep["type"], `project.${string}` | "thread.import">,
) =>
  Effect.gen(function* () {
    const current = yield* getThread(target, threadId);
    const step =
      type === "thread.visibility"
        ? ({ type, threadId, visible: false } as const)
        : ({ type, threadId } as const);
    const next = manageThread(current, step, yield* DateTime.now);
    yield* target.run(
      Effect.flatMap(EventSink.EventSinkV2, (sink) =>
        sink.write({
          commandId: CommandId.make(`local-${type}-${threadId}`),
          events: [
            {
              id: EventId.make(`local-${type}-${threadId}`),
              type: next.type,
              threadId,
              providerInstanceId: next.thread.providerInstanceId,
              occurredAt: DateTime.makeUnsafe(at),
              payload: next.thread,
            } as never,
          ],
        }),
      ),
    );
  });

const importAll = (target: Runtime, sourceHome: string) =>
  Effect.gen(function* () {
    const preview = yield* target.sync((service) =>
      service.execute({ operation: "preview", sourceHome }),
    );
    return yield* target.sync((service) =>
      service.execute({
        operation: "import",
        sourceHome: preview.preview!.sourceHome,
        contentHash: preview.preview!.contentHash,
        mappings: preview.preview!.projects.map((project) => ({
          sourceProjectId: project.sourceProjectId,
          projectId: project.projectId,
        })),
        nightly: true,
      }),
    );
  });

const withHomes = <A, E>(
  prefix: string,
  run: (homes: {
    root: string;
    source: Runtime;
    target: () => Runtime;
    restart: () => Effect.Effect<Runtime>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix)),
    );
    const source = yield* runtime(NodePath.join(root, "source"));
    let target = yield* runtime(NodePath.join(root, "target"));
    try {
      return yield* run({
        root,
        source,
        target: () => target,
        restart: () =>
          Effect.gen(function* () {
            yield* target.dispose();
            target = yield* runtime(NodePath.join(root, "target"));
            return target;
          }).pipe(Effect.orDie),
      });
    } finally {
      yield* target.dispose();
      yield* source.dispose();
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  });

it.effect(
  "keeps a locally deleted conversation deleted across sync, source updates, restart, and undo",
  () =>
    withHomes("t3-sync-lifecycle-", ({ root, source, target, restart }) =>
      Effect.gen(function* () {
        const sourceThreadId = ThreadId.make("source-thread");
        yield* createProject(source, "source-project", root, "Source");
        yield* createThread(
          source,
          "source-project",
          thread("source-thread", "History", [
            {
              id: "question",
              role: "user",
              text: "Original question",
              attachments: [],
              createdAt: at,
            },
          ]),
        );
        const imported = yield* importAll(target(), NodePath.join(root, "source"));
        const firstId = imported.history[0]!.visibleThreadIds[0]!;
        expect((yield* getThread(target(), firstId)).archivedAt).not.toBeNull();

        // A replacement version, so undo has an older one it could wrongly resurrect.
        yield* renameThread(source, sourceThreadId, "Updated history");
        const updated = yield* target().sync((service) =>
          service.execute({ operation: "syncNow" }),
        );
        const updatedId = updated.history[0]!.visibleThreadIds[0]!;
        expect(updatedId).not.toBe(firstId);
        expect((yield* getThread(target(), firstId)).deletedAt).not.toBeNull();
        yield* localAction(target(), updatedId, "thread.visibility");

        yield* restart();
        yield* target().sync((service) => service.execute({ operation: "syncNow" }));
        expect((yield* getThread(target(), updatedId)).deletedAt).not.toBeNull();
        yield* target().sync((service) =>
          service.execute({ operation: "undo", batchId: updated.activeBatchId! }),
        );
        expect((yield* getThread(target(), firstId)).deletedAt).not.toBeNull();

        yield* renameThread(source, sourceThreadId, "Newer history");
        const synced = yield* target().sync((service) => service.execute({ operation: "syncNow" }));
        expect(synced.history[0]!.visibleThreadIds).toEqual([]);
        const shells = yield* target().run(
          Effect.flatMap(ProjectionStore.ProjectionStoreV2, (s) => s.getShellSnapshot()),
        );
        expect(shells.threads).toEqual([]);

        const original = yield* getThread(source, sourceThreadId);
        expect(original.archivedAt).toBeNull();
        expect((yield* getMessages(source, sourceThreadId))[0]?.text).toBe("Original question");
      }),
    ),
);

it.effect(
  "previews, imports, continues independently, and undoes while preserving the continuation",
  () =>
    withHomes("t3-sync-service-", ({ root, source, target, restart }) =>
      Effect.gen(function* () {
        const sourceThreadId = ThreadId.make("source-thread");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(root, "source/userdata/attachments/source-note.txt"),
            "notes",
          ),
        );
        yield* createProject(source, "source-project", root, "Source project");
        yield* createThread(
          source,
          "source-project",
          thread("source-thread", "Original conversation", [
            {
              id: "m1",
              role: "user",
              text: "Preserve this conversation",
              createdAt: at,
              attachments: [
                {
                  type: "file",
                  id: "source-note",
                  name: "notes.txt",
                  mimeType: "text/plain",
                  sizeBytes: 5,
                },
              ],
            },
          ]),
        );
        const preview = yield* target().sync((service) =>
          service.execute({ operation: "preview", sourceHome: NodePath.join(root, "source") }),
        );
        expect(preview.preview?.projects[0]?.threadCount).toBe(1);
        const imported = yield* importAll(target(), NodePath.join(root, "source"));
        expect(imported.configuration.enabled).toBe(true);
        expect(imported.backups).toHaveLength(1);

        // The configuration write is lost after a committed batch; the record restores it.
        yield* target().dispose();
        yield* Effect.promise(() =>
          NodeFSP.unlink(NodePath.join(root, "target/userdata/project-sync.json")),
        );
        yield* restart();
        const restarted = yield* target().sync((service) =>
          service.execute({ operation: "status" }),
        );
        expect(restarted.configuration.enabled).toBe(true);
        expect(restarted.configuration.sourceId).toBe(imported.configuration.sourceId);

        const mirrorId = imported.history[0]!.visibleThreadIds[0]!;
        yield* createProject(source, "later-project", NodePath.join(root, "later"), "Later");
        const refreshed = yield* target().sync((service) =>
          service.execute({ operation: "syncNow" }),
        );
        expect(refreshed.configuration.mappings).toHaveLength(2);
        const laterProjectId = refreshed.history[0]!.projectChanges[0]!.after.id;
        yield* target().sync((service) =>
          service.execute({ operation: "undo", batchId: refreshed.activeBatchId! }),
        );
        const laterProject = yield* target().run(
          Effect.flatMap(ProjectService, (projects) =>
            projects.getById(laterProjectId, { includeDeleted: true }),
          ),
        );
        expect(laterProject._tag === "Some" && laterProject.value.deletedAt).not.toBeNull();

        const continued = yield* target().sync((service) =>
          service.execute({ operation: "continue", threadId: mirrorId }),
        );
        const continuedId = continued.threadId!;
        expect(continuedId.startsWith("t3continue-")).toBe(true);
        expect((yield* getThread(target(), continuedId)).historyOrigin).toBe("v1_import");

        yield* localAction(target(), mirrorId, "thread.unarchive");
        yield* localAction(target(), mirrorId, "thread.unsettle");
        yield* source.run(
          Effect.flatMap(EventSink.EventSinkV2, (sink) =>
            sink.write({
              events: [
                {
                  id: EventId.make("later-answer"),
                  type: "message.updated",
                  threadId: sourceThreadId,
                  occurredAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                  payload: {
                    createdBy: "agent",
                    creationSource: "server",
                    id: MessageId.make("m2"),
                    threadId: sourceThreadId,
                    runId: null,
                    nodeId: null,
                    role: "assistant",
                    text: "A later source answer",
                    attachments: [],
                    streaming: false,
                    createdAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                    updatedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                  },
                },
                {
                  id: EventId.make("later-answer-item"),
                  type: "turn-item.updated",
                  threadId: sourceThreadId,
                  occurredAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                  payload: {
                    id: TurnItemId.make("later-answer-item"),
                    threadId: sourceThreadId,
                    runId: null,
                    nodeId: null,
                    providerThreadId: null,
                    providerTurnId: null,
                    nativeItemRef: null,
                    parentItemId: null,
                    ordinal: 0,
                    status: "completed",
                    title: null,
                    startedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                    completedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                    updatedAt: DateTime.makeUnsafe("2026-09-08T00:00:00.000Z"),
                    type: "assistant_message",
                    messageId: MessageId.make("m2"),
                    text: "A later source answer",
                    streaming: false,
                  },
                },
              ],
            }),
          ),
        );
        const updated = yield* target().sync((service) =>
          service.execute({ operation: "syncNow" }),
        );
        expect(updated.history[0]!.hiddenThreadIds).toContain(mirrorId);
        const updatedId = updated.history[0]!.visibleThreadIds[0]!;
        const updatedThread = yield* getThread(target(), updatedId);
        expect(updatedThread.archivedAt).toBeNull();
        expect(updatedThread.settledOverride).toBe("active");
        expect(yield* getMessages(target(), updatedId)).toHaveLength(2);

        yield* localAction(target(), updatedId, "thread.archive");
        yield* restart();
        yield* target().sync((service) =>
          service.execute({ operation: "undo", batchId: updated.activeBatchId! }),
        );
        const restoredMirror = yield* getThread(target(), mirrorId);
        expect(restoredMirror.deletedAt).toBeNull();
        expect(restoredMirror.archivedAt).not.toBeNull();
        expect(yield* getMessages(target(), mirrorId)).toHaveLength(1);

        const undone = yield* target().sync((service) =>
          service.execute({ operation: "undo", batchId: imported.activeBatchId! }),
        );
        expect(undone.configuration.enabled).toBe(false);
        const [message] = yield* getMessages(target(), continuedId);
        expect(message?.text).toBe("Preserve this conversation");
        const attachment = message!.attachments[0]!;
        expect(
          yield* Effect.promise(() =>
            NodeFSP.readFile(
              NodePath.join(root, "target/userdata/attachments", `${attachment.id}.txt`),
              "utf8",
            ),
          ),
        ).toBe("notes");
        const paused = yield* target().sync((service) =>
          service.execute({ operation: "scheduled" }),
        );
        expect(paused.activeBatchId).toBe(null);
        expect((yield* getThread(target(), mirrorId)).deletedAt).not.toBeNull();
        expect((yield* getThread(target(), continuedId)).deletedAt).toBeNull();
      }),
    ),
);
