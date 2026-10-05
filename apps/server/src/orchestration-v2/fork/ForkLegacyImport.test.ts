import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as LegacyV1ThreadImporter from "../legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../ProjectionStore.ts";
import { aroundLegacyImport, rewriteThreadContextRecords } from "./ForkLegacyImport.ts";

const databaseLayer = SqlitePersistenceMemory;
const storesProvided = Layer.mergeAll(
  databaseLayer,
  EventStore.layer.pipe(Layer.provideMerge(databaseLayer)),
  ProjectionStore.layer.pipe(Layer.provideMerge(databaseLayer)),
);
const eventSinkProvided = EventSink.layer.pipe(Layer.provide(storesProvided));
const TestLayer = Layer.mergeAll(
  storesProvided,
  eventSinkProvided,
  LegacyV1ThreadImporter.layer.pipe(
    Layer.provide(Layer.mergeAll(storesProvided, eventSinkProvided)),
  ),
);

const ENVIRONMENT_ID = EnvironmentId.make("environment-fork");
const forkThreadRecord = JSON.stringify({
  version: 1,
  records: [
    {
      version: 1,
      contextId: "thread-source",
      kind: "thread",
      label: "Source",
      threadId: "thread:source",
      projectId: "project:fork",
      title: "Source",
    },
  ],
});

describe("rewriteThreadContextRecords", () => {
  it("gives fork thread records an environment and leaves upstream ones alone", () => {
    const rewritten = rewriteThreadContextRecords(forkThreadRecord, ENVIRONMENT_ID);
    assert.deepStrictEqual(JSON.parse(rewritten!).records[0], {
      version: 1,
      contextId: "thread-source",
      kind: "thread",
      label: "Source",
      threadId: "thread:source",
      title: "Source",
      environmentId: ENVIRONMENT_ID,
    });
    assert.isNull(rewriteThreadContextRecords(rewritten!, ENVIRONMENT_ID));
    assert.isNull(rewriteThreadContextRecords("not json", ENVIRONMENT_ID));
  });
});

it.layer(TestLayer)("ForkLegacyImport", (it) => {
  it.effect("carries fork thread fields and references across the v2 cutover", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const threadId = ThreadId.make("thread:fork");
      const now = "2026-09-01T00:00:00.000Z";
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project:fork', 'Fork project', '/tmp/fork', '{"instanceId":"codex","model":"gpt-5.4"}',
          '[]', ${now}, ${now}, NULL
        )
      `;
      for (const id of ["thread:source", threadId]) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
            created_at, updated_at
          ) VALUES (
            ${id}, 'project:fork', ${id}, '{"instanceId":"codex","model":"gpt-5.4"}',
            'full-access', 'default', ${now}, ${now}
          )
        `;
      }
      yield* sql`
        UPDATE projection_threads SET
          highlight_color = '#ff8800',
          snooze_reminder = 'Check the deploy',
          snoozed_until = '2099-01-01T00:00:00.000Z',
          snoozed_at = ${now},
          continued_from_thread_id = 'thread:source',
          dependencies_json = '[{"threadId":"thread:source","linkedAt":"2026-09-01T00:00:00.000Z","satisfiedAt":null,"satisfiedReason":null}]'
        WHERE thread_id = ${threadId}
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, attachments_json, context_json,
          is_streaming, created_at, updated_at
        ) VALUES (
          'message:fork:1', ${threadId}, NULL, 'user',
          'Continue [Source](t3-context://v1/thread/thread-source)', '[]', ${forkThreadRecord},
          0, ${now}, ${now}
        )
      `;

      const runImport = aroundLegacyImport(
        Effect.succeed(ENVIRONMENT_ID),
        importer.reconcileShells,
      );
      yield* runImport;

      const thread = yield* projections.getThread(threadId);
      assert.strictEqual(thread.highlightColor, "#ff8800");
      assert.strictEqual(thread.snoozeReminder, "Check the deploy");
      assert.strictEqual(thread.continuedFromThreadId, ThreadId.make("thread:source"));
      assert.deepStrictEqual(
        thread.dependencies?.map((link) => link.threadId),
        [ThreadId.make("thread:source")],
      );
      const [message] = yield* sql<{ readonly environment_id: string }>`
        SELECT json_extract(context_json, '$.records[0].environmentId') AS environment_id
        FROM projection_thread_messages WHERE message_id = 'message:fork:1'
      `;
      assert.strictEqual(message!.environment_id, ENVIRONMENT_ID);
      // The transcript import decodes the rewritten record without failing.
      yield* importer.ensureTranscript(threadId);

      const countForkEvents = sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM orchestration_events
        WHERE event_id LIKE 'migration:v1:fork:%'
      `;
      const [before] = yield* countForkEvents;
      yield* runImport;
      const [after] = yield* countForkEvents;
      assert.strictEqual(before!.count, 1);
      assert.strictEqual(after!.count, 1);
    }),
  );
});
