import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Items gained `progressNotes`. The contract decodes a missing list as empty,
 * so stored `roadmap.item.created` payloads replay without an upgrade; this
 * only writes the field into the item projection, so the stored items match
 * what the server now writes. Items that already have notes are left alone.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    UPDATE projection_roadmap_items
    SET payload_json = json_set(payload_json, '$.progressNotes', json('[]'))
    WHERE json_type(payload_json, '$.progressNotes') IS NULL
  `;
});
