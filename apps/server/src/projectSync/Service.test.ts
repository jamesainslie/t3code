// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  MessageId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Option from "effect/Option";
import { ServerConfig } from "../config.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { makeSqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ProjectSyncService } from "./Service.ts";

const runtime = Effect.fn(function* (home: string) {
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
  const context = yield* Layer.buildWithScope(
    ProjectSyncService.layer.pipe(
      Layer.provideMerge(OrchestrationLayerLive),
      Layer.provideMerge(makeSqlitePersistenceLive(NodePath.join(home, "userdata/state.sqlite"))),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(ServerConfig.layerTest(process.cwd(), home)),
      Layer.provide(NodeServices.layer),
    ),
    scope,
  );
  return {
    run: <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | ProjectSyncService
        | OrchestrationEngineService
        | ProjectionSnapshotQuery
        | SqlClient.SqlClient
      >,
    ) => Effect.provide(effect, context),
    dispose: () => Scope.close(scope, Exit.void),
  };
});

it.effect(
  "previews, imports, continues independently, and undoes while preserving the continuation",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sync-service-")),
      );
      const source = yield* runtime(NodePath.join(root, "source"));
      let target = yield* runtime(NodePath.join(root, "target"));
      const at = "2026-09-07T00:00:00Z";
      const projectId = ProjectId.make("source-project");
      const threadId = ThreadId.make("source-thread");
      try {
        yield* source.run(Effect.service(ProjectSyncService));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(root, "source/userdata/attachments/source-note.txt"),
            "notes",
          ),
        );
        const commands: OrchestrationCommand[] = [
          {
            type: "project.create",
            commandId: CommandId.make("p"),
            projectId,
            title: "Source project",
            workspaceRoot: root,
            createdAt: at,
          },
          {
            type: "thread.create",
            commandId: CommandId.make("t"),
            projectId,
            threadId,
            title: "Original conversation",
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: at,
            historyImport: true,
          },
          {
            type: "thread.history.import",
            commandId: CommandId.make("m"),
            threadId,
            messages: [
              {
                messageId: MessageId.make("m1"),
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
            ],
          },
        ];
        for (const command of commands)
          yield* source.run(
            Effect.flatMap(OrchestrationEngineService, (engine) => engine.dispatch(command)),
          );
        let service = yield* target.run(Effect.service(ProjectSyncService));
        const preview = yield* target.run(
          service.execute({ operation: "preview", sourceHome: NodePath.join(root, "source") }),
        );
        expect(preview.preview?.projects[0]?.threadCount).toBe(1);
        const imported = yield* target.run(
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
        expect(imported.configuration.enabled).toBe(true);
        expect(imported.backups).toHaveLength(1);
        yield* target.dispose();
        // Simulate loss of the configuration write after a committed publication.
        yield* Effect.promise(() =>
          NodeFSP.unlink(NodePath.join(root, "target/userdata/project-sync.json")),
        );
        target = yield* runtime(NodePath.join(root, "target"));
        service = yield* target.run(Effect.service(ProjectSyncService));
        const restarted = yield* target.run(service.execute({ operation: "status" }));
        expect(restarted.configuration.enabled).toBe(true);
        expect(restarted.configuration.sourceId).toBe(imported.configuration.sourceId);
        const mirrorId = imported.history[0]!.visibleThreadIds[0]!;
        yield* source.run(
          Effect.flatMap(OrchestrationEngineService, (engine) =>
            engine.dispatch({
              type: "project.create",
              commandId: CommandId.make("new-project-command"),
              projectId: ProjectId.make("new-source-project"),
              title: "A later project",
              workspaceRoot: NodePath.join(root, "later"),
              createdAt: at,
            }),
          ),
        );
        const refreshed = yield* target.run(service.execute({ operation: "syncNow" }));
        expect(refreshed.configuration.mappings).toHaveLength(2);
        yield* target.run(
          service.execute({ operation: "undo", batchId: refreshed.activeBatchId! }),
        );
        const continued = yield* target.run(
          service.execute({ operation: "continue", threadId: mirrorId }),
        );
        expect(continued.threadId).toBeDefined();
        yield* source.run(
          Effect.flatMap(OrchestrationEngineService, (engine) =>
            engine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: CommandId.make("later-history"),
              threadId,
              messageId: MessageId.make("m2"),
              delta: "A later source answer",
              createdAt: "2026-09-08T00:00:00Z",
            }),
          ),
        );
        yield* source.run(
          Effect.flatMap(OrchestrationEngineService, (engine) =>
            engine.dispatch({
              type: "thread.message.assistant.complete",
              commandId: CommandId.make("later-complete"),
              threadId,
              messageId: MessageId.make("m2"),
              createdAt: "2026-09-08T00:00:00Z",
            }),
          ),
        );
        const updated = yield* target.run(service.execute({ operation: "syncNow" }));
        expect(updated.history[0]!.hiddenThreadIds).toContain(mirrorId);
        yield* target.dispose();
        target = yield* runtime(NodePath.join(root, "target"));
        service = yield* target.run(Effect.service(ProjectSyncService));
        yield* target.run(service.execute({ operation: "undo", batchId: updated.activeBatchId! }));
        const restoredMirror = yield* target.run(
          Effect.flatMap(ProjectionSnapshotQuery, (query) => query.getThreadDetailById(mirrorId)),
        );
        expect(Option.getOrThrow(restoredMirror).messages).toHaveLength(1);
        const undone = yield* target.run(
          service.execute({ operation: "undo", batchId: imported.activeBatchId! }),
        );
        expect(undone.configuration.enabled).toBe(false);
        const snapshot = yield* target.run(
          Effect.flatMap(ProjectionSnapshotQuery, (query) =>
            query.getThreadDetailById(continued.threadId!),
          ),
        );
        expect(Option.getOrThrow(snapshot).messages[0]?.text).toBe("Preserve this conversation");
        const attachment = Option.getOrThrow(snapshot).messages[0]!.attachments![0]!;
        expect(
          yield* Effect.promise(() =>
            NodeFSP.readFile(
              NodePath.join(root, "target/userdata/attachments", `${attachment.id}.txt`),
              "utf8",
            ),
          ),
        ).toBe("notes");
        const paused = yield* target.run(service.execute({ operation: "scheduled" }));
        expect(paused.activeBatchId).toBe(null);
        const mirror = yield* target.run(
          Effect.flatMap(ProjectionSnapshotQuery, (query) => query.getThreadDetailById(mirrorId)),
        );
        expect(Option.isNone(mirror)).toBe(true);
      } finally {
        yield* target.dispose();
        yield* source.dispose();
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
