import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
import migratePlacement from "./050_ProjectionThreadPlacement.ts";

for (const history of ["fork", "upstream"] as const) {
  it.layer(NodeSqliteClient.layerMemory())(`placement upgrade from ${history}`, (it) => {
    it.effect("preserves existing placements and supports both ordering commands", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 48 });
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, model_selection_json, runtime_mode, created_at, updated_at
          ) VALUES (
            'existing', 'project', 'Existing conversation', '{}', 'full-access', '2026-09-07', '2026-09-07'
          )
        `;
        if (history === "fork") {
          yield* sql`ALTER TABLE projection_threads ADD COLUMN pin_position INTEGER`;
          yield* sql`ALTER TABLE projection_threads ADD COLUMN thread_order_key TEXT`;
          yield* sql`UPDATE projection_threads SET pin_position = 2, thread_order_key = 'kn'`;
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (49, 'ProjectionThreadPlacement')`;
        } else {
          yield* runMigrations({ toMigrationInclusive: 49 });
          yield* sql`UPDATE projection_threads SET active_order_key = 'hq'`;
        }
        yield* runMigrations();
        yield* migratePlacement;
        const rows = yield* sql`
          SELECT thread_id, title, pin_position, thread_order_key, active_order_key FROM projection_threads
        `;
        assert.deepEqual(rows, [
          {
            thread_id: "existing",
            title: "Existing conversation",
            pin_position: history === "fork" ? 2 : null,
            thread_order_key: history === "fork" ? "kn" : null,
            active_order_key: history === "upstream" ? "hq" : null,
          },
        ]);
      }),
    );
  });
}
