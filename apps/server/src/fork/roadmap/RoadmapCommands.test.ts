import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  type RoadmapActor,
  type RoadmapCommand,
  RoadmapItemId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

import {
  planRoadmapCommand,
  projectRoadmapEvent,
  type RoadmapItemRecord,
} from "./RoadmapCommands.ts";

const now = DateTime.makeUnsafe("2026-10-18T09:00:00.000Z");
const nowIso = "2026-10-18T09:00:00.000Z";
const earlier = "2026-10-01T00:00:00.000Z";
const id = RoadmapItemId.make;
const commandId = CommandId.make("cmd-1");
const user: RoadmapActor = { _tag: "user" };
const thread = (threadId: string): RoadmapThreadRef => ({
  environmentId: EnvironmentId.make("env-home"),
  threadId: ThreadId.make(threadId),
});
const agent: RoadmapActor = { _tag: "agent", thread: thread("t-agent"), threadTitle: "Agent" };

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
  options: { readonly actor?: RoadmapActor; readonly lastDeletion?: ReadonlyArray<string> } = {},
) =>
  planRoadmapCommand({
    command,
    actor: options.actor ?? user,
    state: {
      items: new Map(records.map((record) => [record.item.id, record])),
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
  const changed = projectRoadmapEvent(
    (itemId) => byId.get(itemId),
    eventOf(plan(command, records, options)),
  );
  for (const record of changed) byId.set(record.item.id, record);
  return byId;
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
});
