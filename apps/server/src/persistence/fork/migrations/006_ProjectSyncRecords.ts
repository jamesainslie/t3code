import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Sync history moves out of the event log. v1 recorded each batch as a
 * `project.sync-recorded` event, which orchestration v2 does not know. Those
 * events stay in `orchestration_events` and are copied here in order, keeping
 * their sequence as the high water mark that undo compares local edits against.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS fork_project_sync_records (
      record_id TEXT PRIMARY KEY,
      position INTEGER NOT NULL UNIQUE,
      high_water_sequence INTEGER NOT NULL,
      record_json TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT OR IGNORE INTO fork_project_sync_records (
      record_id, position, high_water_sequence, record_json
    )
    SELECT json_extract(payload_json, '$.id'), sequence, sequence, payload_json
    FROM orchestration_events
    WHERE event_type = 'project.sync-recorded'
      AND json_extract(payload_json, '$.sourceId') != 'continuation'
    ORDER BY sequence ASC
  `;
});
