import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Roadmap writes an environment off the home sends to the home, in the order
 * they were made. `row_id` is that order. A delivered row is deleted; a row
 * the home refused stays as `rejected` with the home's error, so a refusal is
 * recorded and never retried. `command_id` is unique because the home's
 * receipts already make a resend of one command harmless, and one row per
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
