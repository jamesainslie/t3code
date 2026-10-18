import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  isRoadmapSprintEvent,
  type RoadmapActor,
  type RoadmapCommand,
  RoadmapItemId,
  type RoadmapIssueSource,
  ROADMAP_NO_LOCAL_CHANGES,
  ROADMAP_NOTE_LIMIT,
  type RoadmapNoteKind,
  type RoadmapProgressNote,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planRoadmapCommand,
  projectRoadmapEvent,
  projectRoadmapSprintEvent,
  type RoadmapItemRecord,
} from "./RoadmapCommands.ts";

const now = DateTime.makeUnsafe("2026-10-18T09:00:00.000Z");
const nowIso = "2026-10-18T09:00:00.000Z";
const earlier = "2026-10-01T00:00:00.000Z";
const id = RoadmapItemId.make;
const sid = RoadmapSprintId.make;
const commandId = CommandId.make("cmd-1");
const user: RoadmapActor = { _tag: "user" };
const thread = (threadId: string): RoadmapThreadRef => ({
  environmentId: EnvironmentId.make("env-home"),
  threadId: ThreadId.make(threadId),
});
const agent: RoadmapActor = { _tag: "agent", thread: thread("t-agent"), threadTitle: "Agent" };
const steward: RoadmapActor = { _tag: "steward", environmentId: EnvironmentId.make("env-home") };
const github: RoadmapActor = { _tag: "github" };

const item = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: id(itemId),
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
  createdAt: earlier,
  updatedAt: earlier,
  createdBy: user,
  stateChangedAt: earlier,
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
  ...overrides,
});

const sprint = (sprintId: string, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint => ({
  id: sid(sprintId),
  name: `Sprint ${sprintId}`,
  area: "work",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  ...overrides,
});

const live = (value: RoadmapWorkItem): RoadmapItemRecord => ({ item: value, deletedAt: null });
const gone = (value: RoadmapWorkItem): RoadmapItemRecord => ({ item: value, deletedAt: earlier });

type CommandBody<T extends RoadmapCommand["type"]> = Omit<
  Extract<RoadmapCommand, { type: T }>,
  "type" | "commandId"
>;

const plan = (
  command: RoadmapCommand,
  records: ReadonlyArray<RoadmapItemRecord> = [],
  options: {
    readonly actor?: RoadmapActor;
    readonly lastDeletion?: ReadonlyArray<string>;
    readonly sprints?: ReadonlyArray<RoadmapSprint>;
  } = {},
) =>
  planRoadmapCommand({
    command,
    actor: options.actor ?? user,
    state: {
      items: new Map(records.map((record) => [record.item.id, record])),
      sprints: new Map((options.sprints ?? []).map((value) => [value.id, value])),
      ...(options.lastDeletion === undefined
        ? {}
        : { lastDeletion: options.lastDeletion.map((value) => id(value)) }),
    },
    eventId: EventId.make("event-1"),
    now,
  });

const cmd = <T extends RoadmapCommand["type"]>(type: T, body: CommandBody<T>) =>
  ({ type, commandId, ...body }) as unknown as RoadmapCommand;

const eventOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isSuccess(result), "expected an accepted command");
  return Result.getOrThrow(result);
};
const payloadOf = (result: ReturnType<typeof plan>) =>
  eventOf(result).payload as Record<string, unknown>;
const failureOf = (result: ReturnType<typeof plan>) => {
  assert.isTrue(Result.isFailure(result), "expected a rejection");
  return Result.isFailure(result) ? result.failure : assert.fail("expected a rejection");
};

/** Plans then projects, returning the resulting records by id. */
const run = (
  command: RoadmapCommand,
  records: ReadonlyArray<RoadmapItemRecord>,
  options: Parameters<typeof plan>[2] = {},
) => {
  const byId = new Map(records.map((record) => [record.item.id, record]));
  const event = eventOf(plan(command, records, options));
  assert.isFalse(isRoadmapSprintEvent(event), "expected an item event");
  if (isRoadmapSprintEvent(event)) return byId;
  const changed = projectRoadmapEvent((itemId) => byId.get(itemId), event);
  for (const record of changed) byId.set(record.item.id, record);
  return byId;
};

/** Plans a sprint command then projects it, returning sprints and items after. */
const runSprint = (
  command: RoadmapCommand,
  records: ReadonlyArray<RoadmapItemRecord>,
  sprints: ReadonlyArray<RoadmapSprint>,
  options: Parameters<typeof plan>[2] = {},
) => {
  const items = new Map(records.map((record) => [record.item.id, record]));
  const sprintsById = new Map(sprints.map((value) => [value.id, value]));
  const event = eventOf(plan(command, records, { ...options, sprints }));
  assert.isTrue(isRoadmapSprintEvent(event), "expected a sprint event");
  if (!isRoadmapSprintEvent(event)) return { items, sprints: sprintsById };
  const changed = projectRoadmapSprintEvent(
    { item: (itemId) => items.get(itemId), sprint: (sprintId) => sprintsById.get(sprintId) },
    event,
  );
  for (const record of changed.items) items.set(record.item.id, record);
  for (const change of changed.sprints) {
    if (change.removed) sprintsById.delete(change.sprint.id);
    else sprintsById.set(change.sprint.id, change.sprint);
  }
  return { items, sprints: sprintsById };
};

describe("planRoadmapCommand", () => {
  describe("create", () => {
    const create = (body: Partial<CommandBody<"roadmap.item.create">> = {}) =>
      cmd("roadmap.item.create", { itemId: id("new"), itemType: "feature", title: "New", ...body });

    it("creates an item with defaults, the actor and the event time", () => {
      const event = eventOf(plan(create()));
      assert.equal(event.type, "roadmap.item.created");
      assert.equal(event.occurredAt, nowIso);
      assert.deepEqual(event.actor, user);
      const created = (payloadOf(plan(create())).item ?? {}) as RoadmapWorkItem;
      assert.deepInclude(created, {
        id: id("new"),
        type: "feature",
        state: "backlog",
        priority: null,
        parentId: null,
        needsReview: false,
        createdAt: nowIso,
        createdBy: user,
      });
    });

    it("marks an item an agent created as needing review", () => {
      const created = payloadOf(plan(create(), [], { actor: agent })).item as RoadmapWorkItem;
      assert.isTrue(created.needsReview);
      assert.deepEqual(created.createdBy, agent);
    });

    it("refuses a missing parent", () => {
      assert.equal(failureOf(plan(create({ parentId: id("nope") }))).code, "not_found");
    });

    it("refuses a deleted parent", () => {
      assert.equal(
        failureOf(plan(create({ parentId: id("p") }), [gone(item("p"))])).code,
        "deleted",
      );
    });

    it("refuses a parent whose type cannot hold the new type", () => {
      const failure = failureOf(
        plan(create({ parentId: id("p"), itemType: "objective" }), [live(item("p"))]),
      );
      assert.equal(failure.code, "invalid_parent");
    });

    it("refuses an item id already in use", () => {
      assert.equal(failureOf(plan(create(), [live(item("new"))])).code, "already_exists");
    });

    it("appends after the last sibling", () => {
      const created = payloadOf(
        plan(create({ parentId: id("p") }), [
          live(item("p")),
          live(item("a", { type: "feature", parentId: id("p"), sortKey: "c" })),
          live(item("b", { type: "feature", parentId: id("p"), sortKey: "g" })),
        ]),
      ).item as RoadmapWorkItem;
      assert.isTrue(created.sortKey > "g");
    });

    it("gives a new root the area of the last root the user created", () => {
      const created = payloadOf(
        plan(create({ itemType: "objective" }), [
          live(item("old", { type: "objective", area: "personal", createdAt: earlier })),
          live(item("recent", { type: "objective", area: "work", createdAt: nowIso })),
          live(
            item("agent-made", {
              type: "objective",
              area: "personal",
              createdAt: nowIso,
              createdBy: agent,
            }),
          ),
        ]),
      ).item as RoadmapWorkItem;
      assert.equal(created.area, "work");
    });

    it("gives the first root the personal area and leaves children inheriting", () => {
      const root = payloadOf(plan(create({ itemType: "objective" }))).item as RoadmapWorkItem;
      assert.equal(root.area, "personal");
      const child = payloadOf(plan(create({ parentId: id("p") }), [live(item("p"))]))
        .item as RoadmapWorkItem;
      assert.isNull(child.area);
    });

    it("attaches the thread it was asked to", () => {
      const created = payloadOf(plan(create({ attachThread: thread("t1") })))
        .item as RoadmapWorkItem;
      assert.deepEqual(created.attachments, [{ thread: thread("t1"), attachedAt: nowIso }]);
    });

    it("refuses to attach a thread already on another item", () => {
      const failure = failureOf(
        plan(create({ attachThread: thread("t1") }), [
          live(item("other", { attachments: [{ thread: thread("t1"), attachedAt: earlier }] })),
        ]),
      );
      assert.equal(failure.code, "already_attached");
    });

    it("gives criteria without ids stable ids", () => {
      const created = payloadOf(plan(create({ criteria: [{ text: "One" }, { text: "Two" }] })))
        .item as RoadmapWorkItem;
      assert.deepEqual(
        created.criteria.map((criterion) => criterion.text),
        ["One", "Two"],
      );
      assert.equal(new Set(created.criteria.map((criterion) => criterion.id)).size, 2);
    });
  });

  describe("update", () => {
    const update = (patch: CommandBody<"roadmap.item.update">["patch"], itemId = "f") =>
      cmd("roadmap.item.update", { itemId: id(itemId), patch });
    const tree = [
      live(item("e", { type: "epic" })),
      live(item("f", { type: "feature", parentId: id("e") })),
      live(item("s", { type: "story", parentId: id("f") })),
    ];

    it("carries the patch", () => {
      assert.deepEqual(payloadOf(plan(update({ state: "done", priority: null }), tree)), {
        state: "done",
        priority: null,
      });
    });

    it("refuses a type change the parent cannot hold, naming the parent", () => {
      const failure = failureOf(plan(update({ type: "initiative" }), tree));
      assert.equal(failure.code, "invalid_parent");
      assert.include(failure.message, "Item e");
    });

    it("refuses a type change that cannot hold a child, naming the child", () => {
      const failure = failureOf(plan(update({ type: "story" }), tree));
      assert.equal(failure.code, "invalid_parent");
      assert.include(failure.message, "Item s");
    });

    it("refuses a missing item", () => {
      assert.equal(failureOf(plan(update({ title: "x" }, "nope"), tree)).code, "not_found");
    });

    it("refuses a deleted item", () => {
      assert.equal(failureOf(plan(update({ title: "x" }), [gone(item("f"))])).code, "deleted");
    });

    it("clears needs review when the user edits", () => {
      const after = run(update({ title: "Reviewed" }), [
        live(item("f", { type: "feature", needsReview: true })),
      ]);
      assert.isFalse(after.get(id("f"))!.item.needsReview);
    });
  });

  describe("move", () => {
    const records = [
      live(item("e1")),
      live(item("e2")),
      live(item("a", { type: "feature", parentId: id("e2"), sortKey: "c" })),
      live(item("b", { type: "feature", parentId: id("e2"), sortKey: "g" })),
      live(item("f", { type: "feature", parentId: id("e1") })),
      live(item("s", { type: "story", parentId: id("f") })),
    ];
    const move = (body: Partial<CommandBody<"roadmap.item.move">>) =>
      cmd("roadmap.item.move", { itemId: id("f"), parentId: id("e2"), ...body });

    it("reparents and orders before the named sibling", () => {
      const payload = payloadOf(plan(move({ beforeId: id("b") }), records));
      assert.equal(payload.parentId, "e2");
      assert.isTrue((payload.sortKey as string) > "c" && (payload.sortKey as string) < "g");
    });

    it("orders after the named sibling", () => {
      const payload = payloadOf(plan(move({ afterId: id("b") }), records));
      assert.isTrue((payload.sortKey as string) > "g");
    });

    it("orders first when placed before the first sibling", () => {
      const payload = payloadOf(plan(move({ beforeId: id("a") }), records));
      assert.isTrue((payload.sortKey as string) < "c");
    });

    it("refuses a parent that cannot hold the type", () => {
      assert.equal(failureOf(plan(move({ parentId: id("a") }), records)).code, "invalid_parent");
    });

    it("refuses moving under its own descendant", () => {
      const failure = failureOf(
        plan(cmd("roadmap.item.move", { itemId: id("e1"), parentId: id("s") }), records),
      );
      assert.equal(failure.code, "parent_cycle");
    });

    it("refuses a sibling under another parent", () => {
      assert.equal(failureOf(plan(move({ beforeId: id("s") }), records)).code, "invalid_parent");
    });
  });

  describe("delete and restore", () => {
    const records = [
      live(item("e")),
      live(item("f", { type: "feature", parentId: id("e") })),
      live(item("s", { type: "story", parentId: id("f") })),
      gone(item("old", { type: "feature", parentId: id("e") })),
    ];

    it("deletes the item and its live subtree, recording the ids", () => {
      const payload = payloadOf(plan(cmd("roadmap.item.delete", { itemId: id("e") }), records));
      assert.sameMembers(payload.deletedIds as Array<string>, ["e", "f", "s"]);
    });

    it("restores only what that delete removed", () => {
      const deleted = run(cmd("roadmap.item.delete", { itemId: id("e") }), records);
      const restored = run(
        cmd("roadmap.item.restore", { itemId: id("e") }),
        [...deleted.values()],
        { lastDeletion: ["e", "f", "s"] },
      );
      assert.isNull(restored.get(id("e"))!.deletedAt);
      assert.isNull(restored.get(id("s"))!.deletedAt);
      assert.isNotNull(restored.get(id("old"))!.deletedAt);
    });

    it("refuses to restore under a parent that is still deleted", () => {
      const failure = failureOf(
        plan(
          cmd("roadmap.item.restore", { itemId: id("f") }),
          [gone(item("e")), gone(item("f", { type: "feature", parentId: id("e") }))],
          {
            lastDeletion: ["f"],
          },
        ),
      );
      assert.equal(failure.code, "deleted");
    });
  });

  describe("criteria", () => {
    const records = [
      live(
        item("f", {
          type: "feature",
          criteria: [
            { id: "c1", text: "One", tickedAt: earlier, tickedBy: user, evidence: null },
            { id: "c2", text: "Two", tickedAt: null, tickedBy: null, evidence: null },
          ],
        }),
      ),
    ];

    it("sets criteria, keeping tick state for kept ids", () => {
      const payload = payloadOf(
        plan(
          cmd("roadmap.criteria.set", {
            itemId: id("f"),
            criteria: [{ id: "c1", text: "One, edited" }, { text: "Three" }],
          }),
          records,
        ),
      );
      const criteria = payload.criteria as RoadmapWorkItem["criteria"];
      assert.equal(criteria.length, 2);
      assert.deepInclude(criteria[0]!, { id: "c1", text: "One, edited", tickedAt: earlier });
      assert.deepInclude(criteria[1]!, { text: "Three", tickedAt: null });
    });

    it("records the actor and evidence on a tick", () => {
      const after = run(
        cmd("roadmap.criterion.tick", {
          itemId: id("f"),
          criterionId: "c2",
          ticked: true,
          evidence: "log line 4",
        }),
        records,
        { actor: agent },
      );
      assert.deepEqual(after.get(id("f"))!.item.criteria[1], {
        id: "c2",
        text: "Two",
        tickedAt: nowIso,
        tickedBy: agent,
        evidence: "log line 4",
      });
    });

    it("clears actor and evidence on an untick", () => {
      const after = run(
        cmd("roadmap.criterion.tick", { itemId: id("f"), criterionId: "c1", ticked: false }),
        records,
      );
      assert.deepInclude(after.get(id("f"))!.item.criteria[0]!, {
        tickedAt: null,
        tickedBy: null,
        evidence: null,
      });
    });

    it("refuses an unknown criterion", () => {
      const failure = failureOf(
        plan(
          cmd("roadmap.criterion.tick", { itemId: id("f"), criterionId: "c9", ticked: true }),
          records,
        ),
      );
      assert.equal(failure.code, "criterion_not_found");
    });
  });

  describe("blockers and related", () => {
    const records = [live(item("a", { blockedBy: [id("b")] })), live(item("b")), live(item("c"))];

    it("links a blocker", () => {
      const after = run(
        cmd("roadmap.blocker.link", { itemId: id("c"), blockedById: id("a") }),
        records,
      );
      assert.deepEqual(after.get(id("c"))!.item.blockedBy, [id("a")]);
    });

    it("refuses a self link", () => {
      const failure = failureOf(
        plan(cmd("roadmap.blocker.link", { itemId: id("a"), blockedById: id("a") }), records),
      );
      assert.equal(failure.code, "self_link");
    });

    it("refuses a blocker cycle", () => {
      const failure = failureOf(
        plan(cmd("roadmap.blocker.link", { itemId: id("b"), blockedById: id("a") }), records),
      );
      assert.equal(failure.code, "blocker_cycle");
    });

    it("unlinks idempotently", () => {
      const once = run(
        cmd("roadmap.blocker.unlink", { itemId: id("a"), blockedById: id("b") }),
        records,
      );
      const twice = run(cmd("roadmap.blocker.unlink", { itemId: id("a"), blockedById: id("b") }), [
        ...once.values(),
      ]);
      assert.deepEqual(twice.get(id("a"))!.item.blockedBy, []);
    });

    it("refuses a self related link", () => {
      const failure = failureOf(
        plan(cmd("roadmap.related.link", { itemId: id("a"), relatedId: id("a") }), records),
      );
      assert.equal(failure.code, "self_link");
    });

    it("adds, resolves and removes an external blocker", () => {
      const added = run(
        cmd("roadmap.external-blocker.add", { itemId: id("c"), text: "Legal" }),
        records,
      );
      const blocker = added.get(id("c"))!.item.externalBlockers[0]!;
      assert.deepInclude(blocker, { text: "Legal", resolvedAt: null });
      const resolved = run(
        cmd("roadmap.external-blocker.resolve", {
          itemId: id("c"),
          blockerId: blocker.id,
          resolved: true,
        }),
        [...added.values()],
      );
      assert.equal(resolved.get(id("c"))!.item.externalBlockers[0]!.resolvedAt, nowIso);
      const removed = run(
        cmd("roadmap.external-blocker.remove", { itemId: id("c"), blockerId: blocker.id }),
        [...resolved.values()],
      );
      assert.deepEqual(removed.get(id("c"))!.item.externalBlockers, []);
    });
  });

  describe("attachments", () => {
    const records = [
      live(item("a", { attachments: [{ thread: thread("t1"), attachedAt: earlier }] })),
      live(item("b")),
    ];

    it("attaches a free thread", () => {
      const after = run(
        cmd("roadmap.thread.attach", { itemId: id("b"), thread: thread("t2") }),
        records,
      );
      assert.deepEqual(after.get(id("b"))!.item.attachments, [
        { thread: thread("t2"), attachedAt: nowIso },
      ]);
    });

    it("refuses a thread attached to another item", () => {
      const failure = failureOf(
        plan(cmd("roadmap.thread.attach", { itemId: id("b"), thread: thread("t1") }), records),
      );
      assert.equal(failure.code, "already_attached");
    });

    it("detaches an attached thread", () => {
      const after = run(
        cmd("roadmap.thread.detach", { itemId: id("a"), thread: thread("t1") }),
        records,
      );
      assert.deepEqual(after.get(id("a"))!.item.attachments, []);
    });

    it("refuses to detach a thread that is not attached", () => {
      const failure = failureOf(
        plan(cmd("roadmap.thread.detach", { itemId: id("b"), thread: thread("t1") }), records),
      );
      assert.equal(failure.code, "not_attached");
    });
  });

  it("marks an item reviewed", () => {
    const after = run(cmd("roadmap.item.mark-reviewed", { itemId: id("a") }), [
      live(item("a", { needsReview: true })),
    ]);
    assert.isFalse(after.get(id("a"))!.item.needsReview);
    assert.equal(after.get(id("a"))!.item.updatedAt, nowIso);
  });

  describe("state history", () => {
    const create = (state?: RoadmapWorkItem["state"]) =>
      cmd("roadmap.item.create", {
        itemId: id("new"),
        itemType: "story",
        title: "New",
        ...(state === undefined ? {} : { state }),
      });
    const setState = (state: RoadmapWorkItem["state"], extra: object = {}) =>
      cmd("roadmap.item.update", { itemId: id("a"), patch: { state, ...extra } });

    it("starts a new item's history at creation, with nothing pinned, snoozed, logged or noted", () => {
      const created = payloadOf(plan(create())).item as RoadmapWorkItem;
      assert.deepInclude(created, {
        stateChangedAt: nowIso,
        completedAt: null,
        pinnedAt: null,
        snoozedUntil: null,
        sprintId: null,
        hours: [],
        progressNotes: [],
      });
    });

    it("completes an item created as done", () => {
      const created = payloadOf(plan(create("done"))).item as RoadmapWorkItem;
      assert.equal(created.completedAt, nowIso);
    });

    it("moves stateChangedAt only when the state changes", () => {
      const records = [live(item("a", { state: "in-progress" }))];
      const renamed = run(
        cmd("roadmap.item.update", { itemId: id("a"), patch: { title: "Renamed" } }),
        records,
      ).get(id("a"))!.item;
      assert.equal(renamed.stateChangedAt, earlier);
      const same = run(setState("in-progress"), records).get(id("a"))!.item;
      assert.equal(same.stateChangedAt, earlier);
      const moved = run(setState("in-review"), records).get(id("a"))!.item;
      assert.equal(moved.stateChangedAt, nowIso);
      assert.isNull(moved.completedAt);
    });

    it("sets completedAt on entering done and clears it on reopening", () => {
      const done = run(setState("done"), [live(item("a", { state: "in-review" }))]).get(
        id("a"),
      )!.item;
      assert.equal(done.completedAt, nowIso);
      const reopened = run(setState("in-progress"), [
        live(item("a", { state: "done", completedAt: earlier })),
      ]).get(id("a"))!.item;
      assert.isNull(reopened.completedAt);
      assert.equal(reopened.stateChangedAt, nowIso);
    });

    it("keeps the first completion when done is set again", () => {
      const again = run(setState("done"), [
        live(item("a", { state: "done", completedAt: earlier, stateChangedAt: earlier })),
      ]).get(id("a"))!.item;
      assert.equal(again.completedAt, earlier);
      assert.equal(again.stateChangedAt, earlier);
    });

    it("frees a pick when it is finished", () => {
      const done = run(setState("done"), [live(item("a", { pinnedAt: earlier }))]).get(
        id("a"),
      )!.item;
      assert.isNull(done.pinnedAt);
    });
  });

  describe("pins", () => {
    const pin = (itemId: string) => cmd("roadmap.item.pin", { itemId: id(itemId) });
    const unpin = (itemId: string) => cmd("roadmap.item.unpin", { itemId: id(itemId) });
    const pinned = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}) =>
      live(item(itemId, { pinnedAt: earlier, ...overrides }));

    it("pins an item at the event time and unpins it", () => {
      const after = run(pin("a"), [live(item("a"))]).get(id("a"))!.item;
      assert.equal(after.pinnedAt, nowIso);
      const cleared = run(unpin("a"), [pinned("a")]).get(id("a"))!.item;
      assert.isNull(cleared.pinnedAt);
    });

    it("refuses a fourth pick", () => {
      const records = [pinned("p1"), pinned("p2"), pinned("p3"), live(item("a"))];
      assert.equal(failureOf(plan(pin("a"), records)).code, "pin_limit");
    });

    it("does not count deleted or finished picks toward the limit", () => {
      const records = [
        pinned("p1"),
        pinned("p2"),
        gone(item("p3", { pinnedAt: earlier })),
        pinned("p4", { state: "done" }),
        live(item("a")),
      ];
      assert.equal(run(pin("a"), records).get(id("a"))!.item.pinnedAt, nowIso);
    });

    it("treats pinning a pinned item as a no-op, even at the limit", () => {
      const records = [pinned("p1"), pinned("p2"), pinned("a")];
      assert.equal(run(pin("a"), records).get(id("a"))!.item.pinnedAt, earlier);
    });

    it("refuses to pin a finished item", () => {
      assert.equal(
        failureOf(plan(pin("a"), [live(item("a", { state: "done" }))])).code,
        "invalid_request",
      );
    });

    it("refuses pins from anyone but the user", () => {
      for (const actor of [agent, steward]) {
        for (const command of [pin("a"), unpin("a")]) {
          const failure = failureOf(plan(command, [live(item("a"))], { actor }));
          assert.equal(failure.code, "forbidden_actor");
        }
      }
    });

    it("refuses a missing item", () => {
      assert.equal(failureOf(plan(pin("nope"))).code, "not_found");
    });
  });

  describe("snooze", () => {
    const snooze = (until: string) => cmd("roadmap.item.snooze", { itemId: id("a"), until });
    const records = [live(item("a"))];

    it("snoozes until a later date and unsnoozes", () => {
      assert.equal(
        run(snooze("2026-10-20"), records).get(id("a"))!.item.snoozedUntil,
        "2026-10-20",
      );
      const cleared = run(cmd("roadmap.item.unsnooze", { itemId: id("a") }), [
        live(item("a", { snoozedUntil: "2026-10-20" })),
      ]).get(id("a"))!.item;
      assert.isNull(cleared.snoozedUntil);
    });

    it("refuses a date that is today or earlier everywhere on Earth", () => {
      // At 09:00 UTC it is still the 17th west of UTC-9, so only the 17th and before are past for everyone.
      for (const until of ["2026-10-17", "2026-10-01"]) {
        assert.equal(failureOf(plan(snooze(until), records)).code, "invalid_request");
      }
      assert.equal(
        run(snooze("2026-10-18"), records).get(id("a"))!.item.snoozedUntil,
        "2026-10-18",
      );
    });

    it("refuses snoozes from an agent", () => {
      assert.equal(
        failureOf(plan(snooze("2026-10-20"), records, { actor: agent })).code,
        "forbidden_actor",
      );
      assert.equal(
        failureOf(
          plan(cmd("roadmap.item.unsnooze", { itemId: id("a") }), records, { actor: agent }),
        ).code,
        "forbidden_actor",
      );
    });
  });

  describe("hours", () => {
    const log = (entryId: string, hours: number, note?: string) =>
      cmd("roadmap.hours.log", {
        itemId: id("a"),
        entryId,
        hours,
        ...(note === undefined ? {} : { note }),
      });

    it("appends an entry with the actor and time, from the user or an agent", () => {
      const byUser = run(log("h1", 1.5, "Pairing"), [live(item("a"))]).get(id("a"))!.item;
      assert.deepEqual(byUser.hours, [
        { id: "h1", at: nowIso, hours: 1.5, actor: user, note: "Pairing" },
      ]);
      const existing = { id: "h0", at: earlier, hours: 2, actor: user, note: null };
      const byAgent = run(log("h2", 0.5), [live(item("a", { hours: [existing] }))], {
        actor: agent,
      }).get(id("a"))!.item;
      assert.deepEqual(byAgent.hours, [
        existing,
        { id: "h2", at: nowIso, hours: 0.5, actor: agent, note: null },
      ]);
    });

    it("refuses an entry id already logged", () => {
      const existing = { id: "h1", at: earlier, hours: 2, actor: user, note: null };
      assert.equal(
        failureOf(plan(log("h1", 1), [live(item("a", { hours: [existing] }))])).code,
        "already_exists",
      );
    });

    it("removes an entry by id and refuses an unknown one", () => {
      const entries = [
        { id: "h1", at: earlier, hours: 2, actor: user, note: null },
        { id: "h2", at: earlier, hours: 1, actor: user, note: null },
      ];
      const records = [live(item("a", { hours: entries }))];
      const remove = (entryId: string) => cmd("roadmap.hours.remove", { itemId: id("a"), entryId });
      assert.deepEqual(run(remove("h1"), records).get(id("a"))!.item.hours, entries.slice(1));
      assert.equal(failureOf(plan(remove("nope"), records)).code, "not_found");
    });
  });

  describe("notes", () => {
    const add = (
      noteId: string,
      kind: RoadmapNoteKind = "progress",
      extra: { readonly criterionId?: string | null; readonly itemId?: string } = {},
    ) =>
      cmd("roadmap.note.add", {
        itemId: id(extra.itemId ?? "a"),
        noteId,
        kind,
        text: `Note ${noteId}`,
        ...(extra.criterionId === undefined ? {} : { criterionId: extra.criterionId }),
      });
    const remove = (noteId: string) => cmd("roadmap.note.remove", { itemId: id("a"), noteId });
    const note = (
      noteId: string,
      overrides: Partial<RoadmapProgressNote> = {},
    ): RoadmapProgressNote => ({
      id: noteId,
      at: earlier,
      actor: user,
      kind: "progress",
      text: `Note ${noteId}`,
      criterionId: null,
      ...overrides,
    });
    const criterion = {
      id: "c1",
      text: "Ships",
      tickedAt: null,
      tickedBy: null,
      evidence: null,
    };
    const records = [live(item("a", { criteria: [criterion] }))];

    it("adds a progress note from every actor, with the actor and the event time", () => {
      for (const actor of [user, agent, steward, github]) {
        const after = run(add("n1"), records, { actor }).get(id("a"))!.item;
        assert.deepEqual(after.progressNotes, [
          {
            id: "n1",
            at: nowIso,
            actor,
            kind: "progress",
            text: "Note n1",
            criterionId: null,
          },
        ]);
      }
    });

    it("keeps sync notes to GitHub", () => {
      for (const actor of [user, agent, steward]) {
        assert.equal(
          failureOf(plan(add("n1", "sync"), records, { actor })).code,
          "forbidden_actor",
        );
      }
      const after = run(add("n1", "sync"), records, { actor: github }).get(id("a"))!.item;
      assert.equal(after.progressNotes[0]!.kind, "sync");
    });

    it("keeps drift and unsure notes to the steward", () => {
      for (const kind of ["drift", "unsure"] as const) {
        for (const actor of [user, agent, github]) {
          assert.equal(
            failureOf(plan(add("n1", kind), records, { actor })).code,
            "forbidden_actor",
          );
        }
        const after = run(add("n1", kind), records, { actor: steward }).get(id("a"))!.item;
        assert.equal(after.progressNotes[0]!.kind, kind);
      }
    });

    it("ties a note to a criterion on the item and refuses one the item lacks", () => {
      const after = run(add("n1", "progress", { criterionId: "c1" }), records, { actor: agent });
      assert.equal(after.get(id("a"))!.item.progressNotes[0]!.criterionId, "c1");
      assert.equal(
        failureOf(plan(add("n1", "progress", { criterionId: "c9" }), records)).code,
        "criterion_not_found",
      );
    });

    it("refuses a note id already on the item", () => {
      assert.equal(
        failureOf(plan(add("n1"), [live(item("a", { progressNotes: [note("n1")] }))])).code,
        "already_exists",
      );
    });

    it("refuses a missing or deleted item", () => {
      assert.equal(failureOf(plan(add("n1", "progress", { itemId: "nope" }))).code, "not_found");
      assert.equal(failureOf(plan(add("n1"), [gone(item("a"))])).code, "deleted");
    });

    it("appends the newest note last and keeps only the newest 50", () => {
      const full = Array.from({ length: ROADMAP_NOTE_LIMIT }, (_, index) => note(`old-${index}`));
      const after = run(add("new"), [live(item("a", { progressNotes: full }))]).get(id("a"))!.item;
      assert.equal(after.progressNotes.length, ROADMAP_NOTE_LIMIT);
      assert.equal(after.progressNotes[0]!.id, "old-1");
      assert.equal(after.progressNotes.at(-1)!.id, "new");
    });

    it("removes a note for the user and refuses an unknown one", () => {
      const notes = [note("n1"), note("n2", { actor: steward, kind: "unsure" })];
      const withNotes = [live(item("a", { progressNotes: notes }))];
      assert.deepEqual(
        run(remove("n2"), withNotes).get(id("a"))!.item.progressNotes,
        notes.slice(0, 1),
      );
      assert.equal(failureOf(plan(remove("nope"), withNotes)).code, "not_found");
    });

    it("refuses note removal from anyone but the user", () => {
      const withNotes = [live(item("a", { progressNotes: [note("n1", { actor: agent })] }))];
      for (const actor of [agent, steward, github]) {
        assert.equal(failureOf(plan(remove("n1"), withNotes, { actor })).code, "forbidden_actor");
      }
    });
  });

  describe("GitHub sources", () => {
    const source = (overrides: Partial<RoadmapIssueSource> = {}): RoadmapIssueSource => ({
      host: "github.com",
      owner: "acme",
      repo: "web",
      number: 12,
      nodeId: "I_12",
      url: "https://github.com/acme/web/issues/12",
      writable: true,
      remoteUpdatedAt: "2026-10-17T00:00:00Z",
      syncedAt: earlier,
      base: { title: "Item a", closed: false, parentNodeId: null, blockedByNodeIds: [] },
      localChangedAt: ROADMAP_NO_LOCAL_CHANGES,
      ...overrides,
    });
    const importIssue = (overrides: Partial<CommandBody<"roadmap.source.import">> = {}) =>
      cmd("roadmap.source.import", {
        itemId: id("a"),
        itemType: "story",
        title: "Item a",
        parentId: null,
        area: "work",
        state: "backlog",
        source: source(),
        ...overrides,
      });
    const sourced = (itemId: string, overrides: Partial<RoadmapIssueSource> = {}) =>
      item(itemId, {
        type: "story",
        source: source({ nodeId: `I_${itemId}`, ...overrides }),
      });

    describe("import", () => {
      it("creates the item from the issue for GitHub", () => {
        const after = run(importIssue({ state: "done" }), [], { actor: github }).get(id("a"))!;
        assert.deepEqual(after.item.source, source());
        assert.equal(after.item.type, "story");
        assert.equal(after.item.area, "work");
        assert.equal(after.item.state, "done");
        assert.equal(after.item.completedAt, nowIso);
        assert.deepEqual(after.item.createdBy, github);
        assert.isFalse(after.item.needsReview);
      });

      it("places the item under a parent that can hold it", () => {
        const parent = live(item("p", { type: "epic" }));
        const after = run(importIssue({ parentId: id("p") }), [parent], { actor: github });
        assert.equal(after.get(id("a"))!.item.parentId, "p");
        const story = live(item("s", { type: "story" }));
        assert.equal(
          failureOf(plan(importIssue({ parentId: id("s") }), [story], { actor: github })).code,
          "invalid_parent",
        );
      });

      it("refuses everyone but GitHub", () => {
        for (const actor of [user, agent, steward]) {
          assert.equal(failureOf(plan(importIssue(), [], { actor })).code, "forbidden_actor");
        }
      });

      it("refuses an issue a live item already holds, and accepts it again once that item is deleted", () => {
        const holder = item("b", { source: source() });
        assert.equal(
          failureOf(plan(importIssue(), [live(holder)], { actor: github })).code,
          "already_exists",
        );
        assert.isTrue(Result.isSuccess(plan(importIssue(), [gone(holder)], { actor: github })));
      });
    });

    describe("sync", () => {
      const sync = (itemId = "a") =>
        cmd("roadmap.source.sync", {
          itemId: id(itemId),
          writable: false,
          remoteUpdatedAt: "2026-10-18T08:00:00Z",
          base: { title: "Renamed", closed: true, parentNodeId: "I_p", blockedByNodeIds: ["I_b"] },
        });

      it("records where the item and its issue agree, keeping the local change times", () => {
        const localChangedAt = { ...ROADMAP_NO_LOCAL_CHANGES, title: earlier };
        const records = [live(sourced("a", { localChangedAt }))];
        const after = run(sync(), records, { actor: github }).get(id("a"))!.item.source!;
        assert.isFalse(after.writable);
        assert.equal(after.remoteUpdatedAt, "2026-10-18T08:00:00Z");
        assert.equal(after.syncedAt, nowIso);
        assert.deepEqual(after.base, {
          title: "Renamed",
          closed: true,
          parentNodeId: "I_p",
          blockedByNodeIds: ["I_b"],
        });
        assert.deepEqual(after.localChangedAt, localChangedAt);
        assert.equal(after.nodeId, "I_a");
      });

      it("refuses everyone but GitHub, and an item with no issue", () => {
        assert.equal(
          failureOf(plan(sync(), [live(sourced("a"))], { actor: user })).code,
          "forbidden_actor",
        );
        assert.equal(
          failureOf(plan(sync(), [live(item("a"))], { actor: github })).code,
          "invalid_request",
        );
      });
    });

    describe("unlink", () => {
      const unlink = cmd("roadmap.source.unlink", { itemId: id("a") });

      it("turns the item into a Lathe-only item for the user or GitHub", () => {
        for (const actor of [user, github]) {
          const after = run(unlink, [live(sourced("a"))], { actor }).get(id("a"))!.item;
          assert.isNull(after.source);
        }
      });

      it("refuses agents and the steward, and an item with no issue", () => {
        for (const actor of [agent, steward]) {
          assert.equal(
            failureOf(plan(unlink, [live(sourced("a"))], { actor })).code,
            "forbidden_actor",
          );
        }
        assert.equal(failureOf(plan(unlink, [live(item("a"))])).code, "invalid_request");
      });
    });

    describe("local change times", () => {
      const update = (patch: CommandBody<"roadmap.item.update">["patch"]) =>
        cmd("roadmap.item.update", { itemId: id("a"), patch });
      const changes = (
        command: RoadmapCommand,
        records: ReadonlyArray<RoadmapItemRecord>,
        actor: RoadmapActor = user,
      ) => run(command, records, { actor }).get(id("a"))!.item.source!.localChangedAt;

      it("records when a user or agent renames the item or opens or closes it", () => {
        const records = [live(sourced("a"))];
        assert.equal(changes(update({ title: "New" }), records).title, nowIso);
        assert.equal(changes(update({ state: "done" }), records, agent).closed, nowIso);
        const done = [live(item("a", { ...sourced("a"), state: "done" }))];
        assert.equal(changes(update({ state: "in-progress" }), done).closed, nowIso);
      });

      it("ignores changes that leave the synced fields alone, and GitHub's own", () => {
        const records = [live(sourced("a"))];
        assert.deepEqual(
          changes(update({ state: "in-progress" }), records),
          ROADMAP_NO_LOCAL_CHANGES,
        );
        assert.deepEqual(changes(update({ title: "Item a" }), records), ROADMAP_NO_LOCAL_CHANGES);
        assert.deepEqual(
          changes(update({ title: "New", state: "done" }), records, github),
          ROADMAP_NO_LOCAL_CHANGES,
        );
      });

      it("records a move to another parent but not a reorder", () => {
        const records = [
          live(item("p", { type: "epic" })),
          live(item("q", { type: "epic" })),
          live({ ...sourced("a"), parentId: id("p") }),
          live(item("b", { type: "story", parentId: id("p"), sortKey: "z" })),
        ];
        const move = (parentId: string) =>
          cmd("roadmap.item.move", { itemId: id("a"), parentId: id(parentId) });
        assert.equal(changes(move("q"), records).parent, nowIso);
        assert.isNull(changes(move("p"), records).parent);
      });

      it("records a blocker linked or unlinked", () => {
        const records = [live(sourced("a")), live(sourced("b"))];
        const link = cmd("roadmap.blocker.link", { itemId: id("a"), blockedById: id("b") });
        assert.equal(changes(link, records).blockedBy, nowIso);
        const blocked = [live({ ...sourced("a"), blockedBy: [id("b")] }), live(sourced("b"))];
        const unlink = cmd("roadmap.blocker.unlink", { itemId: id("a"), blockedById: id("b") });
        assert.equal(changes(unlink, blocked).blockedBy, nowIso);
      });

      it("leaves an item with no issue without a source", () => {
        const after = run(update({ title: "New" }), [live(item("a"))]).get(id("a"))!.item;
        assert.isNull(after.source);
      });
    });

    describe("read-only issues", () => {
      const readOnly = (itemId: string) => sourced(itemId, { writable: false });
      const update = (patch: CommandBody<"roadmap.item.update">["patch"]) =>
        cmd("roadmap.item.update", { itemId: id("a"), patch });

      it("refuses user and agent changes to the synced fields", () => {
        const records = [
          live({ ...readOnly("a"), parentId: id("p") }),
          live({ ...sourced("p"), type: "epic" }),
          live(item("q", { type: "epic" })),
          live(sourced("b")),
        ];
        const refused = [
          update({ title: "New" }),
          update({ state: "done" }),
          cmd("roadmap.item.move", { itemId: id("a"), parentId: id("q") }),
          cmd("roadmap.blocker.link", { itemId: id("a"), blockedById: id("b") }),
        ];
        for (const actor of [user, agent]) {
          for (const command of refused) {
            assert.equal(failureOf(plan(command, records, { actor })).code, "read_only_source");
          }
        }
        for (const command of refused) {
          assert.isTrue(Result.isSuccess(plan(command, records, { actor: github })));
        }
      });

      it("accepts changes to fields that stay in Lathe", () => {
        const records = [
          live({ ...readOnly("a"), parentId: id("p") }),
          live(item("p", { type: "epic" })),
          live(item("q", { type: "epic" })),
          live(item("b", { type: "story" })),
        ];
        for (const command of [
          update({ priority: "p1", description: "Notes", state: "in-progress" }),
          update({ title: "Item a" }),
          cmd("roadmap.blocker.link", { itemId: id("a"), blockedById: id("b") }),
          cmd("roadmap.item.move", { itemId: id("a"), parentId: id("q") }),
        ]) {
          assert.isTrue(Result.isSuccess(plan(command, records)));
        }
      });

      it("refuses moving an issue under a read-only issue", () => {
        const records = [
          live({ ...readOnly("p"), type: "epic" }),
          live(sourced("a")),
          live(item("l", { type: "story" })),
        ];
        const under = (itemId: string) =>
          cmd("roadmap.item.move", { itemId: id(itemId), parentId: id("p") });
        assert.equal(failureOf(plan(under("a"), records)).code, "read_only_source");
        assert.isTrue(Result.isSuccess(plan(under("l"), records)));
      });
    });

    describe("pull requests", () => {
      const pullRequest = {
        host: "GitHub.com",
        repository: "Acme/Web",
        number: 7,
        url: "https://github.com/acme/web/pull/7",
      };
      const link = (itemId = "a") =>
        cmd("roadmap.pull-request.link", { itemId: id(itemId), pullRequest });
      const unlink = cmd("roadmap.pull-request.unlink", {
        itemId: id("a"),
        host: "github.com",
        repository: "acme/web",
        number: 7,
      });

      it("links a pull request once, keyed in lower case, from any actor", () => {
        const records = [live(item("a", { type: "feature" }))];
        const once = run(link(), records, { actor: agent });
        const twice = run(link(), [...once.values()]);
        assert.deepEqual(twice.get(id("a"))!.item.pullRequests, [
          { ...pullRequest, host: "github.com", repository: "acme/web" },
        ]);
      });

      it("links only to features, stories, bugs and support tickets", () => {
        for (const type of ["feature", "story", "bug", "support-ticket"] as const) {
          assert.isTrue(Result.isSuccess(plan(link(), [live(item("a", { type }))])));
        }
        for (const type of ["objective", "key-result", "initiative", "epic"] as const) {
          assert.equal(
            failureOf(plan(link(), [live(item("a", { type }))])).code,
            "invalid_request",
          );
        }
      });

      it("unlinks a pull request", () => {
        const records = [
          live(
            item("a", {
              type: "story",
              pullRequests: [{ ...pullRequest, host: "github.com", repository: "acme/web" }],
            }),
          ),
        ];
        assert.deepEqual(run(unlink, records).get(id("a"))!.item.pullRequests, []);
      });
    });
  });

  describe("sprints", () => {
    const create = (overrides: Partial<CommandBody<"roadmap.sprint.create">> = {}) =>
      cmd("roadmap.sprint.create", {
        sprintId: sid("s1"),
        name: "Sprint 1",
        area: "work",
        startDate: "2026-10-19",
        endDate: "2026-10-30",
        ...overrides,
      });

    it("creates a sprint", () => {
      const event = eventOf(plan(create()));
      assert.equal(event.type, "roadmap.sprint.created");
      const after = runSprint(create(), [], []);
      assert.deepEqual(after.sprints.get(sid("s1")), {
        id: sid("s1"),
        name: "Sprint 1",
        area: "work",
        startDate: "2026-10-19",
        endDate: "2026-10-30",
      });
    });

    it("refuses a sprint that ends before it starts, and accepts a one-day sprint", () => {
      assert.equal(
        failureOf(plan(create({ startDate: "2026-10-19", endDate: "2026-10-18" }))).code,
        "invalid_request",
      );
      eventOf(plan(create({ startDate: "2026-10-19", endDate: "2026-10-19" })));
    });

    it("refuses an id already in use", () => {
      assert.equal(
        failureOf(plan(create(), [], { sprints: [sprint("s1")] })).code,
        "already_exists",
      );
    });

    it("updates a sprint and refuses a patch that would end it first", () => {
      const update = (patch: CommandBody<"roadmap.sprint.update">["patch"]) =>
        cmd("roadmap.sprint.update", { sprintId: sid("s1"), patch });
      const after = runSprint(
        update({ name: "Renamed", endDate: "2026-11-06" }),
        [],
        [sprint("s1")],
      );
      assert.deepInclude(after.sprints.get(sid("s1"))!, { name: "Renamed", endDate: "2026-11-06" });
      assert.equal(
        failureOf(plan(update({ endDate: "2026-10-01" }), [], { sprints: [sprint("s1")] })).code,
        "invalid_request",
      );
      assert.equal(failureOf(plan(update({ name: "x" }))).code, "not_found");
    });

    it("deletes a sprint and clears it from its items, deleted ones included", () => {
      const records = [
        live(item("in", { sprintId: sid("s1") })),
        gone(item("gone", { sprintId: sid("s1") })),
        live(item("other", { sprintId: sid("s2") })),
      ];
      const remove = cmd("roadmap.sprint.delete", { sprintId: sid("s1") });
      const event = eventOf(plan(remove, records, { sprints: [sprint("s1"), sprint("s2")] }));
      assert.deepEqual(event.payload, { clearedItemIds: [id("in"), id("gone")] });
      const after = runSprint(remove, records, [sprint("s1"), sprint("s2")]);
      assert.isFalse(after.sprints.has(sid("s1")));
      assert.isTrue(after.sprints.has(sid("s2")));
      assert.isNull(after.items.get(id("in"))!.item.sprintId);
      assert.isNull(after.items.get(id("gone"))!.item.sprintId);
      assert.isNotNull(after.items.get(id("gone"))!.deletedAt);
      assert.equal(after.items.get(id("other"))!.item.sprintId, sid("s2"));
      assert.equal(failureOf(plan(remove)).code, "not_found");
    });

    it("refuses sprint changes from an agent", () => {
      for (const command of [
        create(),
        cmd("roadmap.sprint.update", { sprintId: sid("s1"), patch: { name: "x" } }),
        cmd("roadmap.sprint.delete", { sprintId: sid("s1") }),
      ]) {
        const failure = failureOf(plan(command, [], { actor: agent, sprints: [sprint("s1")] }));
        assert.equal(failure.code, "forbidden_actor");
      }
    });

    it("puts an item in a sprint and takes it out again", () => {
      const assign = (sprintId: RoadmapSprintId | null) =>
        cmd("roadmap.item.update", { itemId: id("a"), patch: { sprintId } });
      const records = [live(item("a"))];
      const options = { sprints: [sprint("s1")] };
      assert.equal(run(assign(sid("s1")), records, options).get(id("a"))!.item.sprintId, "s1");
      const out = run(assign(null), [live(item("a", { sprintId: sid("s1") }))], options);
      assert.isNull(out.get(id("a"))!.item.sprintId);
    });

    it("refuses an unknown sprint, and sprint changes on an item from an agent", () => {
      const assign = cmd("roadmap.item.update", {
        itemId: id("a"),
        patch: { sprintId: sid("s1") },
      });
      assert.equal(failureOf(plan(assign, [live(item("a"))])).code, "not_found");
      assert.equal(
        failureOf(plan(assign, [live(item("a"))], { actor: agent, sprints: [sprint("s1")] })).code,
        "forbidden_actor",
      );
    });

    describe("creating an item into a sprint", () => {
      const createIn = (sprintId: RoadmapSprintId | null) =>
        cmd("roadmap.item.create", {
          itemId: id("new"),
          itemType: "feature",
          title: "New",
          sprintId,
        });

      it("creates the item in the sprint", () => {
        const after = run(createIn(sid("s1")), [], { sprints: [sprint("s1")] });
        assert.equal(after.get(id("new"))!.item.sprintId, "s1");
        assert.isNull(run(createIn(null), []).get(id("new"))!.item.sprintId);
      });

      it("refuses a sprint from an agent", () => {
        assert.equal(
          failureOf(plan(createIn(sid("s1")), [], { actor: agent, sprints: [sprint("s1")] })).code,
          "forbidden_actor",
        );
      });

      it("refuses an unknown sprint", () => {
        assert.equal(failureOf(plan(createIn(sid("s1")))).code, "invalid_request");
      });
    });
  });
});
