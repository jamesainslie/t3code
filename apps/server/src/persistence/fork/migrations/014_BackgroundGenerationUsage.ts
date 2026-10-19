import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * One row per background text-generation call: what it was for and which
 * provider session answered. `usage_json` is set only when the provider keeps
 * no history of the call, so the row is the call's only usage record.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS background_generation_usage (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at_ms INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      model TEXT NOT NULL,
      usage_json TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_background_generation_usage_recorded_at
      ON background_generation_usage(recorded_at_ms)
  `;
});
