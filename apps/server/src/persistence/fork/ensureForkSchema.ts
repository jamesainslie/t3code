import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fork-only schema, applied idempotently AFTER the upstream migration chain.
 *
 * Fork schema must never join the numbered migration chain: the migrator only
 * runs ids greater than the latest recorded id, so a fork-numbered migration
 * either collides with an upstream id (databases written by upstream record
 * that id and silently skip the fork DDL, crashing later on a missing column)
 * or, if numbered above upstream, becomes the recorded maximum and blocks
 * every future upstream migration from running.
 */
export const ensureForkSchema = Effect.fn("ensureForkSchema")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql`SELECT name FROM pragma_table_info('projection_projects')`;
  if (!projectColumns.some((column) => column.name === "remote_host_json")) {
    yield* Effect.log("[fork-schema] adding projection_projects.remote_host_json");
    yield* sql`ALTER TABLE projection_projects ADD COLUMN remote_host_json TEXT`;
  }
});
