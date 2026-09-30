import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateContinuedFrom from "./060_ProjectionThreadsContinuedFrom.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "060_ProjectionThreadsContinuedFrom",
  (it) => {
    it.effect("adds a null continued-from link to existing threads and tolerates re-runs", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 59 });
        const now = "2026-01-01T00:00:00.000Z";
        yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', ${now}, ${now}
        )
      `;
        yield* runMigrations({ toMigrationInclusive: 60 });
        const migrated = yield* sql<{ readonly continuedFromThreadId: string | null }>`
        SELECT continued_from_thread_id AS "continuedFromThreadId" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
        assert.deepEqual(migrated, [{ continuedFromThreadId: null }]);
        const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_projection_threads_continued_from'
      `;
        assert.deepEqual(indexes, [{ name: "idx_projection_threads_continued_from" }]);

        yield* sql`UPDATE projection_threads SET continued_from_thread_id = 'thread-0' WHERE thread_id = 'thread-1'`;
        yield* migrateContinuedFrom;
        const rows = yield* sql<{ readonly continuedFromThreadId: string | null }>`
        SELECT continued_from_thread_id AS "continuedFromThreadId" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
        assert.deepEqual(rows, [{ continuedFromThreadId: "thread-0" }]);
      }),
    );
  },
);
