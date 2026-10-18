import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * How far the roadmap steward has read each of this environment's threads.
 * `digested_until` is the end time of the newest turn it gave the model, so a
 * later run reads only turns that ended after it. Each environment keeps its
 * own rows: the steward reads only the threads it owns, whatever the home.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS roadmap_steward_threads (
      thread_id TEXT PRIMARY KEY,
      digested_until TEXT NOT NULL,
      ran_at TEXT NOT NULL
    )
  `;
});
