import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_document_comments (
      thread_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      anchor_json TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      PRIMARY KEY (thread_id, comment_id)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_document_comments_thread
    ON projection_thread_document_comments(thread_id)
  `;
});
