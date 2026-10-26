import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Items gained an issue `source` and linked `pullRequests`. Stored events already replay, since
 * the contract decodes them as null and empty; this writes both into the item projection so
 * stored items match what the server now writes. Items that already carry either field keep it.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_roadmap_items
    SET payload_json = json_set(payload_json, '$.source', json('null'))
    WHERE json_type(payload_json, '$.source') IS NULL
  `;
  yield* sql`
    UPDATE projection_roadmap_items
    SET payload_json = json_set(payload_json, '$.pullRequests', json('[]'))
    WHERE json_type(payload_json, '$.pullRequests') IS NULL
  `;
});
