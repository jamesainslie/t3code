import { expect, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  MessageId,
  type ProjectSyncApplyCommand,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig } from "../config.ts";
import { OrchestrationLayerLive } from "../orchestration/runtimeLayer.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";

const system = Effect.gen(function* () {
  const context = yield* Layer.buildWithScope(
    OrchestrationLayerLive.pipe(
      Layer.provideMerge(SqlitePersistenceMemory),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-sync-publish-" })),
      Layer.provide(NodeServices.layer),
    ),
    yield* Scope.Scope,
  );
  const engine = yield* Effect.service(OrchestrationEngineService).pipe(Effect.provide(context));
  const query = yield* Effect.service(ProjectionSnapshotQuery).pipe(Effect.provide(context));
  const sql = yield* Effect.service(SqlClient.SqlClient).pipe(Effect.provide(context));
  return {
    dispatch: engine.dispatch,
    snapshot: () => query.getSnapshot(),
    thread: query.getThreadDetailById,
    failMessageWrites: () =>
      sql`CREATE TRIGGER fail_sync_message BEFORE INSERT ON projection_thread_messages BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`,
    eventCount: () => sql<{ count: number }>`SELECT COUNT(*) AS count FROM orchestration_events`,
  };
});

function publication(): ProjectSyncApplyCommand {
  const at = "2026-09-07T00:00:00Z";
  const commandId = CommandId.make("sync-publish-1");
  const projectId = ProjectId.make("sync-project");
  const threadId = ThreadId.make("t3sync-source-thread-version");
  return {
    type: "project.sync.apply",
    commandId,
    projectId,
    expectedSequence: 0,
    commands: [
      {
        type: "project.create",
        commandId,
        projectId,
        title: "Example",
        workspaceRoot: "/example",
        createdAt: at,
      },
      {
        type: "thread.create",
        commandId,
        projectId,
        threadId,
        title: "Imported",
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
        commandId,
        threadId,
        messages: [
          {
            messageId: MessageId.make("sync-message"),
            role: "user",
            text: "Preserved history",
            createdAt: at,
            attachments: [
              {
                type: "file",
                id: "sync-asset",
                name: "notes.txt",
                mimeType: "text/plain",
                sizeBytes: 5,
              },
            ],
          },
        ],
      },
    ],
    record: {
      id: "batch-1",
      sourceId: "source",
      sourceHome: "/source",
      contentHash: "one",
      createdAt: at,
      parentId: null,
      undoBatchId: null,
      mappings: [],
      projectChanges: [],
      visibleThreadIds: [threadId],
      hiddenThreadIds: [],
    },
  };
}

it.effect(
  "publishes history and attachments once, then hides and restores it without losing history",
  () =>
    Effect.gen(function* () {
      const app = yield* system;
      const command = publication();
      const threadId = command.record.visibleThreadIds[0]!;
      const result = yield* app.dispatch(command);
      expect(yield* app.dispatch(command)).toEqual(result);
      const imported = Option.getOrThrow(yield* app.thread(threadId));
      expect(imported.messages[0]?.attachments?.[0]?.name).toBe("notes.txt");
      for (const [id, deletedAt] of [
        ["hide", command.record.createdAt],
        ["restore", null],
      ] as const) {
        const snapshot = yield* app.snapshot();
        yield* app.dispatch({
          ...command,
          commandId: CommandId.make(id),
          expectedSequence: snapshot.snapshotSequence,
          commands: [
            {
              type: "thread.sync.visibility",
              commandId: CommandId.make(id),
              threadId,
              deletedAt,
              updatedAt: command.record.createdAt,
            },
          ],
          record: { ...command.record, id },
        });
        const visible = yield* app.thread(threadId);
        if (deletedAt !== null) expect(Option.isNone(visible)).toBe(true);
        else expect(Option.getOrThrow(visible).deletedAt).toBe(null);
      }
      expect(Option.getOrThrow(yield* app.thread(threadId)).messages[0]?.text).toBe(
        "Preserved history",
      );
    }),
);

it.effect("rejects an invalid publication without leaving its project behind", () =>
  Effect.gen(function* () {
    const app = yield* system;
    const command = publication();
    expect(
      (yield* app
        .dispatch({ ...command, commands: [...command.commands, command.commands[1]!] })
        .pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect((yield* app.snapshot()).projects).toEqual([]);
  }),
);

it.effect(
  "rolls back earlier events, projections, and the journal if a later database write fails",
  () =>
    Effect.gen(function* () {
      const app = yield* system;
      yield* app.failMessageWrites();
      expect((yield* app.dispatch(publication()).pipe(Effect.result))._tag).toBe("Failure");
      expect((yield* app.snapshot()).projects).toEqual([]);
      expect((yield* app.eventCount())[0]?.count).toBe(0);
    }),
);
