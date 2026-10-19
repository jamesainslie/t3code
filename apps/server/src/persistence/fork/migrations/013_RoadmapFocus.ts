import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Items gained `focusedAt`, the user's focus set. The contract decodes a
 * missing value as null, so stored events replay without an upgrade; this
 * writes the field into the item projection so stored items match what the
 * server now writes. Items already in focus keep it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_roadmap_items
    SET payload_json = json_set(payload_json, '$.focusedAt', json('null'))
    WHERE json_type(payload_json, '$.focusedAt') IS NULL
  `;
});
