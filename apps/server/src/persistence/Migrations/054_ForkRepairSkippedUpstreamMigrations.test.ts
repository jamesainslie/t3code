import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const seedLinkedThread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (
      project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
    )
    VALUES (
      'project-1', 'Project 1', '/tmp/project-1', '[]',
      '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', NULL
    )
  `;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, linked_pull_request_json, created_at, updated_at
    )
    VALUES (
      'thread-linked', 'project-1', 'Linked', '{"instanceId":"codex","model":"gpt-5.4"}',
      '{"projectId":"project-1","repository":"acme/widgets","number":42,"url":"https://github.com/acme/widgets/pull/42"}',
      '2026-03-01T00:00:01.000Z', '2026-03-02T00:00:00.000Z'
    )
  `;
});

const readState = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id ASC
  `;
  const pullRequests = yield* sql<{ readonly threadId: string; readonly number: number }>`
    SELECT thread_id AS "threadId", number FROM projection_thread_pull_requests ORDER BY thread_id
  `;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  return {
    recordedIds: recorded.map((row) => row.migration_id),
    recordedNames: new Map(recorded.map((row) => [row.migration_id, row.name] as const)),
    pullRequests,
    columnNames: columns.map((column) => column.name),
  };
});

it.layer(Layer.fresh(NodeSqliteClient.layerMemory()))("054 on a fork database", (it) => {
  it.effect("creates the pull request projection that fork installs skipped", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 48 });

      // A fork install before this refresh: its placement migration ran as
      // id 49 and again as id 50, adding these columns, and both rows sit in
      // the migration table under the fork's name.
      yield* sql`ALTER TABLE projection_threads ADD COLUMN active_order_key TEXT`;
      yield* sql`ALTER TABLE projection_threads ADD COLUMN pin_position INTEGER`;
      yield* sql`ALTER TABLE projection_threads ADD COLUMN thread_order_key TEXT`;
      for (const id of [49, 50]) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name, created_at)
          VALUES (${id}, 'ProjectionThreadPlacement', '2026-09-08T00:00:00.000Z')
        `;
      }
      yield* seedLinkedThread;

      const executed = yield* runMigrations();

      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [51, 52, 53, 54],
      );
      const state = yield* readState;
      assert.deepStrictEqual(state.pullRequests, [{ threadId: "thread-linked", number: 42 }]);
      assert.strictEqual(state.recordedNames.get(50), "ProjectionThreadPlacement");
      assert.strictEqual(state.recordedNames.get(54), "ForkRepairSkippedUpstreamMigrations");
      // Upstream's later migrations still landed on top of the fork schema.
      assert.ok(state.columnNames.includes("title_state_json"));
      assert.ok(state.columnNames.includes("pin_position"));
    }),
  );
});

it.layer(Layer.fresh(NodeSqliteClient.layerMemory()))("054 on an upstream database", (it) => {
  it.effect("is a no-op when 049 and 050 already ran", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 48 });
      yield* seedLinkedThread;
      yield* runMigrations({ toMigrationInclusive: 53 });
      const before = yield* readState;

      const executed = yield* runMigrations();

      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [54],
      );
      const after = yield* readState;
      assert.deepStrictEqual(after.pullRequests, before.pullRequests);
      assert.deepStrictEqual(after.columnNames, before.columnNames);
      assert.deepStrictEqual(after.recordedIds, [...before.recordedIds, 54]);
    }),
  );
});
