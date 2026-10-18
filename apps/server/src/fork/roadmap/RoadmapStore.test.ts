import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  type RoadmapEvent,
  RoadmapError,
  RoadmapItemId,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as RoadmapStore from "./RoadmapStore.ts";

const at = "2026-10-18T09:00:00.000Z";
const later = "2026-10-18T10:00:00.000Z";
const user = { _tag: "user" } as const;
const thread = { environmentId: EnvironmentId.make("env-home"), threadId: ThreadId.make("t1") };
let eventCounter = 0;

const item = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: RoadmapItemId.make(itemId),
  type: "epic",
  title: `Item ${itemId}`,
  description: "",
  parentId: null,
  sortKey: "n",
  state: "backlog",
  priority: null,
  area: null,
  dueDate: null,
  startDate: null,
  estimate: null,
  criteria: [],
  blockedBy: [],
  externalBlockers: [],
  related: [],
  attachments: [],
  origin: null,
  needsReview: false,
  createdAt: at,
  updatedAt: at,
  createdBy: user,
  stateChangedAt: at,
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  ...overrides,
});

const meta = (itemId: string, occurredAt = at) => ({
  eventId: EventId.make(`event-${(eventCounter += 1)}`),
  itemId: RoadmapItemId.make(itemId),
  actor: user,
  occurredAt,
});

const created = (value: RoadmapWorkItem): RoadmapEvent => ({
  ...meta(value.id),
  type: "roadmap.item.created",
  payload: { item: value },
});

/** Appends then projects, as the service does inside its transaction. */
const commit = (event: RoadmapEvent) =>
  Effect.gen(function* () {
    const store = yield* RoadmapStore.RoadmapStore;
    const sequence = yield* store.append(event, CommandId.make(`cmd-${event.eventId}`));
    return yield* store.apply(event, sequence);
  });

const layer = RoadmapStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

it.layer(layer)("RoadmapStore", (it) => {
  it.effect("merges an update into the created item", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      yield* commit(created(item("merge")));
      yield* commit({
        ...meta("merge", later),
        type: "roadmap.item.updated",
        payload: { title: "Renamed", priority: "p1" },
      });
      const record = Option.getOrThrow(yield* store.get(RoadmapItemId.make("merge")));
      assert.deepInclude(record.item, {
        title: "Renamed",
        priority: "p1",
        state: "backlog",
        updatedAt: later,
      });
      assert.isNull(record.deletedAt);
    }),
  );

  it.effect("records attachments so a thread finds its item", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      const sql = yield* SqlClient.SqlClient;
      yield* commit(created(item("attach")));
      yield* commit({ ...meta("attach"), type: "roadmap.thread.attached", payload: { thread } });
      const rows = yield* sql`
        SELECT item_id FROM projection_roadmap_attachments WHERE thread_id = 't1'
      `;
      assert.deepEqual(rows, [{ item_id: "attach" }]);
      const found = yield* store.forThread(thread);
      assert.deepEqual(
        found.map((value) => value.id),
        ["attach"],
      );
      yield* commit({ ...meta("attach"), type: "roadmap.thread.detached", payload: { thread } });
      assert.deepEqual(yield* store.forThread(thread), []);
    }),
  );

  it.effect("hides deleted items from list but not from get with includeDeleted", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      yield* commit(created(item("doomed")));
      yield* commit({
        ...meta("doomed"),
        type: "roadmap.item.deleted",
        payload: { deletedIds: [RoadmapItemId.make("doomed")] },
      });
      const listed = (yield* store.list()).map((record) => record.item.id);
      assert.notInclude(listed, RoadmapItemId.make("doomed"));
      assert.isTrue(Option.isNone(yield* store.get(RoadmapItemId.make("doomed"))));
      const record = yield* store.get(RoadmapItemId.make("doomed"), { includeDeleted: true });
      assert.equal(Option.getOrThrow(record).deletedAt, at);
      const deletion = yield* store.lastDeletion(RoadmapItemId.make("doomed"));
      assert.deepEqual(Option.getOrThrow(deletion), [RoadmapItemId.make("doomed")]);
    }),
  );

  it.effect("keeps history and the latest sequence", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      yield* commit(created(item("history")));
      yield* commit({ ...meta("history"), type: "roadmap.item.reviewed", payload: {} });
      const history = yield* store.history(RoadmapItemId.make("history"));
      assert.deepEqual(
        history.map((entry) => entry.event.type),
        ["roadmap.item.created", "roadmap.item.reviewed"],
      );
      assert.equal(yield* store.latestSequence(), history.at(-1)!.sequence);
    }),
  );

  it.effect("round-trips accepted and rejected receipts", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      const accepted = {
        commandId: CommandId.make("cmd-accepted"),
        status: "accepted" as const,
        resultSequence: 4,
        itemId: RoadmapItemId.make("a"),
        error: null,
        acceptedAt: at,
      };
      const rejected = {
        commandId: CommandId.make("cmd-rejected"),
        status: "rejected" as const,
        resultSequence: null,
        itemId: RoadmapItemId.make("a"),
        error: new RoadmapError({ code: "parent_cycle", message: "Loops." }),
        acceptedAt: at,
      };
      yield* store.writeReceipt(accepted);
      yield* store.writeReceipt(rejected);
      assert.deepEqual(Option.getOrThrow(yield* store.receipt(accepted.commandId)), accepted);
      const read = Option.getOrThrow(yield* store.receipt(rejected.commandId));
      assert.equal(read.error?.code, "parent_cycle");
      assert.isTrue(Option.isNone(yield* store.receipt(CommandId.make("cmd-unknown"))));
    }),
  );

  it.effect("rebuilds the same projection from the event log", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      const sql = yield* SqlClient.SqlClient;
      yield* commit(created(item("rebuild-a", { sortKey: "c" })));
      yield* commit(created(item("rebuild-b", { sortKey: "g" })));
      yield* commit({ ...meta("rebuild-b"), type: "roadmap.thread.attached", payload: { thread } });
      const before = yield* store.list();
      yield* sql`UPDATE projection_roadmap_items SET payload_json = '{}', sort_key = 'zzz'`;
      yield* sql`DELETE FROM projection_roadmap_attachments`;
      yield* store.rebuild();
      assert.deepEqual(yield* store.list(), before);
      assert.lengthOf(yield* store.forThread(thread), 1);
    }),
  );

  const sprintMeta = (sprintId: string, occurredAt = at) => ({
    eventId: EventId.make(`event-${(eventCounter += 1)}`),
    sprintId: RoadmapSprintId.make(sprintId),
    actor: user,
    occurredAt,
  });
  const sprint = (sprintId: string, startDate = "2026-10-19"): RoadmapSprint => ({
    id: RoadmapSprintId.make(sprintId),
    name: `Sprint ${sprintId}`,
    area: "work",
    startDate,
    endDate: "2026-10-30",
  });

  it.effect("projects sprints, and a delete takes the sprint off its items", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      const first = yield* commit({
        ...sprintMeta("s-late"),
        type: "roadmap.sprint.created",
        payload: { sprint: sprint("s-late", "2026-11-02") },
      });
      assert.deepEqual(first, {
        items: [],
        sprints: [{ sprint: sprint("s-late", "2026-11-02"), removed: false }],
      });
      yield* commit({
        ...sprintMeta("s-early"),
        type: "roadmap.sprint.created",
        payload: { sprint: sprint("s-early") },
      });
      yield* commit({
        ...sprintMeta("s-early", later),
        type: "roadmap.sprint.updated",
        payload: { name: "Renamed" },
      });
      assert.deepEqual(
        (yield* store.listSprints()).map((value) => [value.id, value.name]),
        [
          ["s-early", "Renamed"],
          ["s-late", "Sprint s-late"],
        ],
      );

      yield* commit(created(item("in-sprint", { sprintId: RoadmapSprintId.make("s-late") })));
      const deleted = yield* commit({
        ...sprintMeta("s-late", later),
        type: "roadmap.sprint.deleted",
        payload: { clearedItemIds: [RoadmapItemId.make("in-sprint")] },
      });
      assert.deepEqual(
        deleted.sprints.map((change) => [change.sprint.id, change.removed]),
        [["s-late", true]],
      );
      assert.deepEqual(
        deleted.items.map((record) => [record.item.id, record.item.sprintId]),
        [["in-sprint", null]],
      );
      const record = Option.getOrThrow(yield* store.get(RoadmapItemId.make("in-sprint")));
      assert.isNull(record.item.sprintId);
      assert.deepEqual(
        (yield* store.listSprints()).map((value) => value.id),
        ["s-early"],
      );
    }),
  );

  it.effect("keeps sprint events out of an item's history and rebuilds sprints", () =>
    Effect.gen(function* () {
      const store = yield* RoadmapStore.RoadmapStore;
      const sql = yield* SqlClient.SqlClient;
      yield* commit({
        ...sprintMeta("s-rebuild"),
        type: "roadmap.sprint.created",
        payload: { sprint: sprint("s-rebuild") },
      });
      yield* commit(created(item("hist", { sprintId: RoadmapSprintId.make("s-rebuild") })));
      const history = yield* store.history(RoadmapItemId.make("hist"));
      assert.deepEqual(
        history.map((entry) => entry.event.type),
        ["roadmap.item.created"],
      );
      const before = yield* store.listSprints();
      yield* sql`DELETE FROM projection_roadmap_sprints`;
      yield* store.rebuild();
      assert.deepEqual(yield* store.listSprints(), before);
    }),
  );
});
