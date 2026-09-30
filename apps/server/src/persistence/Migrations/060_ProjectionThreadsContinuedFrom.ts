import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// The index serves the reverse lookup: which threads continue a given thread.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "continued_from_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN continued_from_thread_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_continued_from
    ON projection_threads(continued_from_thread_id)
  `;
});
