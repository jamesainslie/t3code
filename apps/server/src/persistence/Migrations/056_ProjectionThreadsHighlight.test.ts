import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateHighlight from "./056_ProjectionThreadsHighlight.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "056_ProjectionThreadsHighlight",
  (it) => {
    it.effect("adds a null highlight to existing threads and tolerates re-runs", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 55 });
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
        yield* runMigrations({ toMigrationInclusive: 56 });
        const migrated = yield* sql<{ readonly highlightColor: string | null }>`
        SELECT highlight_color AS "highlightColor" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
        assert.deepEqual(migrated, [{ highlightColor: null }]);

        yield* sql`UPDATE projection_threads SET highlight_color = '#ff8800' WHERE thread_id = 'thread-1'`;
        yield* migrateHighlight;
        const rows = yield* sql<{ readonly highlightColor: string | null }>`
        SELECT highlight_color AS "highlightColor" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
        assert.deepEqual(rows, [{ highlightColor: "#ff8800" }]);
      }),
    );
  },
);
