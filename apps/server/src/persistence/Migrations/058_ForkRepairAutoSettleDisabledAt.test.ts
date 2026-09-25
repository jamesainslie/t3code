import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const readThreadColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  return columns.map((column) => column.name);
});

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "058 on a fork database",
  (it) => {
    it.effect("adds the auto-settle column that upstream's 054 would have added", () =>
      Effect.gen(function* () {
        // A fork install before this refresh recorded its own migrations as 54-57.
        yield* runMigrations({ toMigrationInclusive: 57 });
        assert.notOk((yield* readThreadColumns).includes("auto_settle_disabled_at"));

        const executed = yield* runMigrations();

        assert.deepStrictEqual(
          executed.map(([id]) => id),
          [58],
        );
        assert.ok((yield* readThreadColumns).includes("auto_settle_disabled_at"));
      }),
    );
  },
);

it.layer(Layer.fresh(NodeSqliteClient.layer({ filename: ":memory:" })))(
  "058 on an upstream database",
  (it) => {
    it.effect("is a no-op when upstream's 054 already added the column", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 57 });
        yield* sql`ALTER TABLE projection_threads ADD COLUMN auto_settle_disabled_at TEXT`;

        const executed = yield* runMigrations();

        assert.deepStrictEqual(
          executed.map(([id]) => id),
          [58],
        );
        const columns = yield* readThreadColumns;
        assert.strictEqual(columns.filter((name) => name === "auto_settle_disabled_at").length, 1);
      }),
    );
  },
);
