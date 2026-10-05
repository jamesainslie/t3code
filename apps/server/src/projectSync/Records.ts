import { ProjectSyncRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(ProjectSyncRecord));
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(ProjectSyncRecord));

/** Sync batches, newest first. */
export const readSyncHistory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly record_json: string }>`
    SELECT record_json FROM fork_project_sync_records ORDER BY position DESC
  `;
  return rows.map((row) => decodeRecord(row.record_json));
});

/**
 * The event log position a batch finished at. Local edits after it are the
 * user's, so undo leaves them alone.
 */
export const syncRecordHighWater = Effect.fn("ProjectSync.recordHighWater")(function* (
  recordId: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly high_water_sequence: number }>`
    SELECT high_water_sequence FROM fork_project_sync_records WHERE record_id = ${recordId}
  `;
  return rows[0]?.high_water_sequence ?? 0;
});

/** Appends a batch after its events have been written. */
export const insertSyncRecord = Effect.fn("ProjectSync.insertRecord")(function* (
  record: ProjectSyncRecord,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO fork_project_sync_records (record_id, position, high_water_sequence, record_json)
    VALUES (
      ${record.id},
      (SELECT COALESCE(MAX(position), 0) + 1 FROM fork_project_sync_records),
      (SELECT COALESCE(MAX(sequence), 0) FROM orchestration_events),
      ${encodeRecord(record)}
    )
  `;
});
