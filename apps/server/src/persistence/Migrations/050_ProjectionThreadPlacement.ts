import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  // Existing fork installs used migration 49 for placement, so they skip
  // upstream's migration 49. Ensure both schemas without changing saved order.
  if (!columns.some((column) => column.name === "active_order_key")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN active_order_key TEXT`;
  }
  if (!columns.some((column) => column.name === "pin_position")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN pin_position INTEGER`;
  }
  if (!columns.some((column) => column.name === "thread_order_key")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN thread_order_key TEXT`;
  }
});
