import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Items keep their calendar history (state changes, completion, pins, snooze,
 * sprint, logged hours) inside `payload_json`, so no item column is needed.
 *
 * Phase 1 items have none of those fields. The projection takes them from
 * `updated_at`, the closest record of when the state last moved. Created
 * events are upgraded too, with the creation time, because a `rebuild`
 * decodes every stored event with the current schema and replays later state
 * changes on top. Each step only touches rows that still lack the fields, so
 * running it again is harmless.
 *
 * Sprint events name their sprint in `roadmap_events.item_id`; the column is
 * the event's subject, not always an item.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_roadmap_items
    SET payload_json = json_set(
      payload_json,
      '$.stateChangedAt', json_extract(payload_json, '$.updatedAt'),
      '$.completedAt', CASE
        WHEN json_extract(payload_json, '$.state') = 'done'
          THEN json_extract(payload_json, '$.updatedAt')
        ELSE NULL
      END,
      '$.pinnedAt', NULL,
      '$.snoozedUntil', NULL,
      '$.sprintId', NULL,
      '$.hours', json('[]')
    )
    WHERE json_type(payload_json, '$.stateChangedAt') IS NULL
  `;
  yield* sql`
    UPDATE roadmap_events
    SET payload_json = json_set(
      payload_json,
      '$.item.stateChangedAt', json_extract(payload_json, '$.item.createdAt'),
      '$.item.completedAt', CASE
        WHEN json_extract(payload_json, '$.item.state') = 'done'
          THEN json_extract(payload_json, '$.item.createdAt')
        ELSE NULL
      END,
      '$.item.pinnedAt', NULL,
      '$.item.snoozedUntil', NULL,
      '$.item.sprintId', NULL,
      '$.item.hours', json('[]')
    )
    WHERE event_type = 'roadmap.item.created'
      AND json_type(payload_json, '$.item') = 'object'
      AND json_type(payload_json, '$.item.stateChangedAt') IS NULL
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_roadmap_sprints (
      sprint_id TEXT PRIMARY KEY,
      area TEXT NOT NULL,
      start_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_sequence INTEGER NOT NULL
    )
  `;
});
