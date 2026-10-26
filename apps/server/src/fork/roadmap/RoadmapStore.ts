/**
 * Persistence for the roadmap's sibling event stream: the append-only
 * `roadmap_events` log, command receipts, and the item and attachment
 * projections. Callers own the transaction; only `rebuild` opens its own.
 */
import {
  CommandId,
  isRoadmapSprintEvent,
  IsoDateTime,
  RoadmapError,
  RoadmapEvent,
  type RoadmapItemEvent,
  RoadmapItemId,
  RoadmapSprint,
  type RoadmapSprintId,
  RoadmapStoredEvent,
  type RoadmapThreadRef,
  RoadmapWorkItem,
} from "@lathe/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import {
  projectRoadmapEvent,
  projectRoadmapSprintEvent,
  type RoadmapItemRecord,
  type RoadmapSprintChange,
} from "./RoadmapCommands.ts";

export class RoadmapStoreError extends Schema.TaggedError<RoadmapStoreError>()(
  "RoadmapStoreError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Roadmap store operation '${this.operation}' failed.`;
  }
}

export const RoadmapCommandReceipt = Schema.Struct({
  commandId: CommandId,
  status: Schema.Literals(["accepted", "rejected"]),
  resultSequence: Schema.NullOr(Schema.Number),
  itemId: Schema.NullOr(RoadmapItemId),
  error: Schema.NullOr(RoadmapError),
  acceptedAt: IsoDateTime,
});
export type RoadmapCommandReceipt = typeof RoadmapCommandReceipt.Type;

const ReceiptDbRow = Schema.Struct({
  ...RoadmapCommandReceipt.fields,
  error: Schema.NullOr(Schema.fromJsonString(RoadmapError)),
});

const ItemDbRow = Schema.Struct({
  item: Schema.fromJsonString(RoadmapWorkItem),
  deletedAt: Schema.NullOr(IsoDateTime),
});

const SprintDbRow = Schema.Struct({ sprint: Schema.fromJsonString(RoadmapSprint) });

/** What one event changed, for the live stream. */
interface RoadmapProjectionChange {
  readonly items: ReadonlyArray<RoadmapItemRecord>;
  readonly sprints: ReadonlyArray<RoadmapSprintChange>;
}

// The event union decodes after the row is reassembled, so payloads read as plain JSON here.
const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const EventDbRow = Schema.Struct({
  sequence: Schema.Number,
  commandId: Schema.String,
  eventId: Schema.String,
  /** The `item_id` column, which holds the sprint id for sprint events. */
  subjectId: Schema.String,
  type: Schema.String,
  actor: UnknownJson,
  payload: UnknownJson,
  occurredAt: Schema.String,
});

const DeletionPayload = Schema.fromJsonString(
  Schema.Struct({ deletedIds: Schema.Array(RoadmapItemId) }),
);

export class RoadmapStore extends Context.Service<
  RoadmapStore,
  {
    /** Returns the event's sequence. */
    readonly append: (
      event: RoadmapEvent,
      commandId: CommandId,
    ) => Effect.Effect<number, RoadmapStoreError>;
    /** Returns the items and sprints the event changed. */
    readonly apply: (
      event: RoadmapEvent,
      sequence: number,
    ) => Effect.Effect<RoadmapProjectionChange, RoadmapStoreError>;
    readonly get: (
      itemId: RoadmapItemId,
      options?: { readonly includeDeleted?: boolean },
    ) => Effect.Effect<Option.Option<RoadmapItemRecord>, RoadmapStoreError>;
    /** Ordered by parent, then sibling order. */
    readonly list: (options?: {
      readonly includeDeleted?: boolean;
    }) => Effect.Effect<ReadonlyArray<RoadmapItemRecord>, RoadmapStoreError>;
    /** Ordered by start date. */
    readonly listSprints: () => Effect.Effect<ReadonlyArray<RoadmapSprint>, RoadmapStoreError>;
    readonly forThread: (
      thread: RoadmapThreadRef,
    ) => Effect.Effect<ReadonlyArray<RoadmapWorkItem>, RoadmapStoreError>;
    readonly latestSequence: () => Effect.Effect<number, RoadmapStoreError>;
    readonly history: (
      itemId: RoadmapItemId,
    ) => Effect.Effect<ReadonlyArray<RoadmapStoredEvent>, RoadmapStoreError>;
    /** The ids removed by the latest delete that covered the item. */
    readonly lastDeletion: (
      itemId: RoadmapItemId,
    ) => Effect.Effect<Option.Option<ReadonlyArray<RoadmapItemId>>, RoadmapStoreError>;
    readonly receipt: (
      commandId: CommandId,
    ) => Effect.Effect<Option.Option<RoadmapCommandReceipt>, RoadmapStoreError>;
    readonly writeReceipt: (
      receipt: RoadmapCommandReceipt,
    ) => Effect.Effect<void, RoadmapStoreError>;
    /** Drops the projections and replays the event log into them. */
    readonly rebuild: () => Effect.Effect<void, RoadmapStoreError>;
  }
>()("lathe/fork/roadmap/RoadmapStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const encodeEvent = Schema.encodeEffect(RoadmapEvent);
  const encodeItem = Schema.encodeEffect(ItemDbRow);
  const encodeSprint = Schema.encodeEffect(SprintDbRow);
  const encodeReceipt = Schema.encodeEffect(ReceiptDbRow);
  const decodeStoredEvent = Schema.decodeUnknownEffect(RoadmapStoredEvent);
  const encodeJson = Schema.encodeEffect(UnknownJson);
  const decodeDeletion = Schema.decodeEffect(DeletionPayload);

  const mapError =
    (operation: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.mapError((cause) => new RoadmapStoreError({ operation, cause })));

  const selectItems = SqlSchema.findAll({
    Request: Schema.Struct({
      itemId: Schema.optional(RoadmapItemId),
      includeDeleted: Schema.Boolean,
    }),
    Result: ItemDbRow,
    execute: (request) => sql`
      SELECT payload_json AS "item", deleted_at AS "deletedAt"
      FROM projection_roadmap_items
      WHERE ${sql.and([
        ...(request.includeDeleted ? [] : [sql`deleted_at IS NULL`]),
        ...(request.itemId === undefined ? [] : [sql`item_id = ${request.itemId}`]),
      ])}
      ORDER BY parent_id ASC, sort_key ASC, item_id ASC
    `,
  });

  const selectSprints = SqlSchema.findAll({
    Request: Schema.Struct({ sprintId: Schema.optional(Schema.String) }),
    Result: SprintDbRow,
    execute: (request) => sql`
      SELECT payload_json AS "sprint"
      FROM projection_roadmap_sprints
      WHERE ${sql.and(request.sprintId === undefined ? [] : [sql`sprint_id = ${request.sprintId}`])}
      ORDER BY start_date ASC, sprint_id ASC
    `,
  });

  const selectThreadItems = SqlSchema.findAll({
    Request: Schema.Struct({ environmentId: Schema.String, threadId: Schema.String }),
    Result: ItemDbRow,
    execute: (request) => sql`
      SELECT items.payload_json AS "item", items.deleted_at AS "deletedAt"
      FROM projection_roadmap_attachments attachments
      JOIN projection_roadmap_items items ON items.item_id = attachments.item_id
      WHERE attachments.environment_id = ${request.environmentId}
        AND attachments.thread_id = ${request.threadId}
        AND items.deleted_at IS NULL
      ORDER BY attachments.attached_at ASC, items.item_id ASC
    `,
  });

  const selectEvents = SqlSchema.findAll({
    Request: Schema.Struct({ itemId: Schema.optional(RoadmapItemId) }),
    Result: EventDbRow,
    execute: (request) => sql`
      SELECT
        sequence,
        command_id AS "commandId",
        event_id AS "eventId",
        item_id AS "subjectId",
        event_type AS "type",
        actor_json AS "actor",
        payload_json AS "payload",
        occurred_at AS "occurredAt"
      FROM roadmap_events
      WHERE ${sql.and(request.itemId === undefined ? [] : [sql`item_id = ${request.itemId}`])}
      ORDER BY sequence ASC
    `,
  });

  const selectReceipt = SqlSchema.findOneOption({
    Request: CommandId,
    Result: ReceiptDbRow,
    execute: (commandId) => sql`
      SELECT
        command_id AS "commandId",
        status,
        result_sequence AS "resultSequence",
        item_id AS "itemId",
        error_json AS "error",
        accepted_at AS "acceptedAt"
      FROM roadmap_command_receipts
      WHERE command_id = ${commandId}
    `,
  });

  const toStoredEvents = (rows: ReadonlyArray<typeof EventDbRow.Type>) =>
    Effect.forEach(rows, (row) =>
      decodeStoredEvent({
        sequence: row.sequence,
        commandId: row.commandId,
        event: {
          type: row.type,
          eventId: row.eventId,
          ...(row.type.startsWith("roadmap.sprint.")
            ? { sprintId: row.subjectId }
            : { itemId: row.subjectId }),
          actor: row.actor,
          occurredAt: row.occurredAt,
          payload: row.payload,
        },
      }),
    );

  const get: RoadmapStore["Service"]["get"] = (itemId, options) =>
    selectItems({ itemId, includeDeleted: options?.includeDeleted === true }).pipe(
      Effect.map((rows) => Option.fromUndefinedOr(rows[0])),
      mapError("get"),
    );

  const writeRecord = Effect.fn("RoadmapStore.writeRecord")(function* (
    record: RoadmapItemRecord,
    sequence: number,
  ) {
    const encoded = yield* encodeItem(record);
    yield* sql`
      INSERT INTO projection_roadmap_items (
        item_id, parent_id, sort_key, deleted_at, payload_json, updated_sequence
      ) VALUES (
        ${record.item.id},
        ${record.item.parentId},
        ${record.item.sortKey},
        ${record.deletedAt},
        ${encoded.item},
        ${sequence}
      )
      ON CONFLICT (item_id) DO UPDATE SET
        parent_id = excluded.parent_id,
        sort_key = excluded.sort_key,
        deleted_at = excluded.deleted_at,
        payload_json = excluded.payload_json,
        updated_sequence = excluded.updated_sequence
    `;
    yield* sql`DELETE FROM projection_roadmap_attachments WHERE item_id = ${record.item.id}`;
    for (const attachment of record.item.attachments) {
      yield* sql`
        INSERT INTO projection_roadmap_attachments (
          item_id, environment_id, thread_id, attached_at
        ) VALUES (
          ${record.item.id},
          ${attachment.thread.environmentId},
          ${attachment.thread.threadId},
          ${attachment.attachedAt}
        )
      `;
    }
  });

  const writeSprint = Effect.fn("RoadmapStore.writeSprint")(function* (
    change: RoadmapSprintChange,
    sequence: number,
  ) {
    if (change.removed) {
      yield* sql`DELETE FROM projection_roadmap_sprints WHERE sprint_id = ${change.sprint.id}`;
      return;
    }
    const encoded = yield* encodeSprint(change);
    yield* sql`
      INSERT INTO projection_roadmap_sprints (
        sprint_id, area, start_date, payload_json, updated_sequence
      ) VALUES (
        ${change.sprint.id},
        ${change.sprint.area},
        ${change.sprint.startDate},
        ${encoded.sprint},
        ${sequence}
      )
      ON CONFLICT (sprint_id) DO UPDATE SET
        area = excluded.area,
        start_date = excluded.start_date,
        payload_json = excluded.payload_json,
        updated_sequence = excluded.updated_sequence
    `;
  });

  const readRecords = Effect.fn("RoadmapStore.readRecords")(function* (
    itemIds: ReadonlyArray<RoadmapItemId>,
  ) {
    const current = new Map<RoadmapItemId, RoadmapItemRecord>();
    for (const itemId of itemIds) {
      const rows = yield* selectItems({ itemId, includeDeleted: true });
      if (rows[0] !== undefined) current.set(itemId, rows[0]);
    }
    return current;
  });

  const touchedIds = (event: RoadmapItemEvent): ReadonlyArray<RoadmapItemId> => {
    switch (event.type) {
      case "roadmap.item.created":
        return [];
      case "roadmap.item.deleted":
        return event.payload.deletedIds;
      case "roadmap.item.restored":
        return event.payload.restoredIds;
      default:
        return [event.itemId];
    }
  };

  const applyEvent = Effect.fn("RoadmapStore.applyEvent")(function* (
    event: RoadmapEvent,
    sequence: number,
  ) {
    if (isRoadmapSprintEvent(event)) {
      const current = yield* readRecords(
        event.type === "roadmap.sprint.deleted" ? event.payload.clearedItemIds : [],
      );
      const sprintRows = yield* selectSprints({ sprintId: event.sprintId });
      const sprints = new Map<RoadmapSprintId, RoadmapSprint>(
        sprintRows.map((row) => [row.sprint.id, row.sprint]),
      );
      const changed = projectRoadmapSprintEvent(
        { item: (itemId) => current.get(itemId), sprint: (sprintId) => sprints.get(sprintId) },
        event,
      );
      for (const change of changed.sprints) yield* writeSprint(change, sequence);
      for (const record of changed.items) yield* writeRecord(record, sequence);
      return changed;
    }
    const current = yield* readRecords(touchedIds(event));
    const items = projectRoadmapEvent((itemId) => current.get(itemId), event);
    for (const record of items) yield* writeRecord(record, sequence);
    const change: RoadmapProjectionChange = { items, sprints: [] };
    return change;
  });

  const apply: RoadmapStore["Service"]["apply"] = (event, sequence) =>
    applyEvent(event, sequence).pipe(mapError("apply"));

  const append: RoadmapStore["Service"]["append"] = Effect.fn("RoadmapStore.append")(function* (
    event,
    commandId,
  ) {
    const encoded = yield* encodeEvent(event);
    const rows = yield* sql<{ readonly sequence: number }>`
      INSERT INTO roadmap_events (
        event_id, command_id, item_id, event_type, actor_json, payload_json, occurred_at
      ) VALUES (
        ${encoded.eventId},
        ${commandId},
        ${"sprintId" in encoded ? encoded.sprintId : encoded.itemId},
        ${encoded.type},
        ${yield* encodeJson(encoded.actor)},
        ${yield* encodeJson(encoded.payload)},
        ${encoded.occurredAt}
      )
      RETURNING sequence
    `;
    return rows[0]!.sequence;
  }, mapError("append"));

  const latestSequence: RoadmapStore["Service"]["latestSequence"] = () =>
    sql<{ readonly sequence: number | null }>`
      SELECT MAX(sequence) AS sequence FROM roadmap_events
    `.pipe(
      Effect.map((rows) => rows[0]?.sequence ?? 0),
      mapError("latestSequence"),
    );

  const lastDeletion: RoadmapStore["Service"]["lastDeletion"] = Effect.fn(
    "RoadmapStore.lastDeletion",
  )(function* (itemId) {
    const rows = yield* sql<{ readonly payload: string }>`
      SELECT events.payload_json AS payload
      FROM roadmap_events events
      WHERE events.event_type = 'roadmap.item.deleted'
        AND EXISTS (
          SELECT 1 FROM json_each(events.payload_json, '$.deletedIds')
          WHERE json_each.value = ${itemId}
        )
      ORDER BY events.sequence DESC
      LIMIT 1
    `;
    if (rows[0] === undefined) return Option.none();
    const payload = yield* decodeDeletion(rows[0].payload);
    return Option.some(payload.deletedIds);
  }, mapError("lastDeletion"));

  const writeReceipt: RoadmapStore["Service"]["writeReceipt"] = Effect.fn(
    "RoadmapStore.writeReceipt",
  )(function* (receipt) {
    const encoded = yield* encodeReceipt(receipt);
    yield* sql`
      INSERT INTO roadmap_command_receipts (
        command_id, status, result_sequence, item_id, error_json, accepted_at
      ) VALUES (
        ${encoded.commandId},
        ${encoded.status},
        ${encoded.resultSequence},
        ${encoded.itemId},
        ${encoded.error},
        ${encoded.acceptedAt}
      )
      ON CONFLICT (command_id) DO NOTHING
    `;
  }, mapError("writeReceipt"));

  const rebuild: RoadmapStore["Service"]["rebuild"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`DELETE FROM projection_roadmap_attachments`;
          yield* sql`DELETE FROM projection_roadmap_items`;
          yield* sql`DELETE FROM projection_roadmap_sprints`;
          const events = yield* toStoredEvents(yield* selectEvents({}));
          for (const stored of events) yield* applyEvent(stored.event, stored.sequence);
        }),
      )
      .pipe(mapError("rebuild"));

  return RoadmapStore.of({
    append,
    apply,
    get,
    list: Effect.fn("RoadmapStore.list")((options?: { readonly includeDeleted?: boolean }) =>
      selectItems({ includeDeleted: options?.includeDeleted === true }).pipe(mapError("list")),
    ),
    listSprints: Effect.fn("RoadmapStore.listSprints")(() =>
      selectSprints({}).pipe(
        Effect.map((rows) => rows.map((row) => row.sprint)),
        mapError("listSprints"),
      ),
    ),
    forThread: Effect.fn("RoadmapStore.forThread")((thread: RoadmapThreadRef) =>
      selectThreadItems({ environmentId: thread.environmentId, threadId: thread.threadId }).pipe(
        Effect.map((rows) => rows.map((row) => row.item)),
        mapError("forThread"),
      ),
    ),
    latestSequence,
    history: Effect.fn("RoadmapStore.history")((itemId: RoadmapItemId) =>
      selectEvents({ itemId }).pipe(Effect.flatMap(toStoredEvents), mapError("history")),
    ),
    lastDeletion,
    receipt: Effect.fn("RoadmapStore.receipt")((commandId: CommandId) =>
      selectReceipt(commandId).pipe(mapError("receipt")),
    ),
    writeReceipt,
    rebuild,
  });
});

export const layer = Layer.effect(RoadmapStore, make);
