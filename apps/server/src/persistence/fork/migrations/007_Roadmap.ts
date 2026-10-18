import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * The roadmap is a sibling event stream, not an `orchestration_events`
 * aggregate: receipts, replay readers and projection rebuilds there only know
 * projects and threads. `rebuild` replays `roadmap_events` into the
 * projections, so they can be dropped and refilled at any time.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS roadmap_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      command_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_json TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_roadmap_events_item ON roadmap_events(item_id, sequence)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS roadmap_command_receipts (
      command_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      result_sequence INTEGER,
      item_id TEXT,
      error_json TEXT,
      accepted_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_roadmap_items (
      item_id TEXT PRIMARY KEY,
      parent_id TEXT,
      sort_key TEXT NOT NULL,
      deleted_at TEXT,
      payload_json TEXT NOT NULL,
      updated_sequence INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_roadmap_items_parent
      ON projection_roadmap_items(parent_id, sort_key)
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_roadmap_attachments (
      item_id TEXT NOT NULL,
      environment_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      attached_at TEXT NOT NULL,
      PRIMARY KEY (item_id, environment_id, thread_id)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_roadmap_attachments_thread
      ON projection_roadmap_attachments(environment_id, thread_id)
  `;
});
