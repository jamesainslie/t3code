import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Roadmap writes an environment off the home sends to the home, ordered by `row_id`. A delivered
 * row is deleted; one the home refused stays `rejected` with its error and is never retried.
 * `command_id` is unique because home receipts already make resends harmless, and one row per
 * command keeps a retried agent call from queueing it twice.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS roadmap_link_outbox (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      command_id TEXT NOT NULL UNIQUE,
      command_json TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      enqueued_at TEXT NOT NULL,
      last_attempt_at TEXT,
      error_json TEXT
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_roadmap_link_outbox_status
      ON roadmap_link_outbox(status, row_id)
  `;
});
