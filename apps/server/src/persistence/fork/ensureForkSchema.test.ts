import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

// Each block builds its own in-memory database; the scenarios are mutually
// exclusive schema states and must not share a connection.
const freshLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const repeatLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const retiredIdLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const partialLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const hasRemoteHostColumn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql`SELECT name FROM pragma_table_info('projection_projects')`;
  return columns.some((column) => column.name === "remote_host_json");
});

freshLayer("ensureForkSchema on a fresh database", (it) => {
  it.effect("adds remote_host_json when running the full migration chain", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      assert.isTrue(yield* hasRemoteHostColumn);
    }),
  );
});

repeatLayer("ensureForkSchema across restarts", (it) => {
  it.effect("is idempotent across repeated startups", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      yield* runMigrations();
      assert.isTrue(yield* hasRemoteHostColumn);
    }),
  );
});

retiredIdLayer("ensureForkSchema on databases from the fork-numbered era", (it) => {
  it.effect("tolerates databases the retired fork-numbered migration already altered", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Databases migrated while the fork DDL lived at a numbered id (026)
      // already have the column; the ensure step must not re-add it.
      yield* runMigrations({ toMigrationInclusive: 25 });
      yield* sql`ALTER TABLE projection_projects ADD COLUMN remote_host_json TEXT`;

      yield* runMigrations();

      assert.isTrue(yield* hasRemoteHostColumn);
    }),
  );
});

partialLayer("ensureForkSchema during partial chain replays", (it) => {
  it.effect("does not run the fork schema during partial-chain migration runs", () =>
    Effect.gen(function* () {
      // Migration tests replay the upstream chain up to a specific id and
      // assert exact schema; the fork ensure step must stay out of the way.
      yield* runMigrations({ toMigrationInclusive: 25 });
      assert.isFalse(yield* hasRemoteHostColumn);
    }),
  );
});
