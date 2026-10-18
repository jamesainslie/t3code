import {
  EnvironmentId,
  RoadmapItemId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyRoadmapStreamItem,
  attachedItemFor,
  blockedState,
  boardColumns,
  buildTree,
  filterTree,
  roadmapItemsById,
  type RoadmapTreeNode,
} from "./roadmapTree.ts";

const at = "2026-10-18T09:00:00.000Z";
const id = RoadmapItemId.make;
const thread = (threadId: string): RoadmapThreadRef => ({
  environmentId: EnvironmentId.make("env-home"),
  threadId: ThreadId.make(threadId),
});

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
  createdAt: at,
  updatedAt: at,
  createdBy: { _tag: "user" },
  ...overrides,
});

const ids = (nodes: ReadonlyArray<RoadmapTreeNode>): ReadonlyArray<unknown> =>
  nodes.map((node) =>
    node.children.length === 0 ? node.item.id : [node.item.id, ids(node.children)],
  );

describe("applyRoadmapStreamItem", () => {
  const snapshot = applyRoadmapStreamItem(null, {
    type: "snapshot",
    sequence: 5,
    items: [item("a"), item("b")],
  });

  it("replaces state with a snapshot", () => {
    const replaced = applyRoadmapStreamItem(snapshot, {
      type: "snapshot",
      sequence: 9,
      items: [item("c")],
    });
    expect(replaced?.sequence).toBe(9);
    expect(replaced?.items.map((entry) => entry.id)).toEqual(["c"]);
  });

  it("ignores deltas before the first snapshot", () => {
    expect(
      applyRoadmapStreamItem(null, { type: "item.removed", sequence: 6, itemId: id("a") }),
    ).toBeNull();
  });

  it("drops deltas at or below the snapshot sequence", () => {
    const stale = applyRoadmapStreamItem(snapshot, {
      type: "item.upserted",
      sequence: 5,
      item: item("a", { title: "Stale" }),
    });
    expect(stale).toBe(snapshot);
  });

  it("upserts and removes later items, keeping every change from one event", () => {
    const updated = applyRoadmapStreamItem(snapshot, {
      type: "item.upserted",
      sequence: 6,
      item: item("a", { title: "Fresh" }),
    });
    const added = applyRoadmapStreamItem(updated, {
      type: "item.upserted",
      sequence: 7,
      item: item("d"),
    });
    const removedA = applyRoadmapStreamItem(added, {
      type: "item.removed",
      sequence: 8,
      itemId: id("a"),
    });
    const removedB = applyRoadmapStreamItem(removedA, {
      type: "item.removed",
      sequence: 8,
      itemId: id("b"),
    });
    expect(updated?.items.find((entry) => entry.id === id("a"))?.title).toBe("Fresh");
    expect(removedB?.items.map((entry) => entry.id)).toEqual(["d"]);
    expect(removedB?.sequence).toBe(8);
  });
});

describe("buildTree", () => {
  it("nests children under parents in sort key order", () => {
    const tree = buildTree([
      item("e2", { sortKey: "t" }),
      item("f2", { type: "feature", parentId: id("e1"), sortKey: "t" }),
      item("e1", { sortKey: "c" }),
      item("f1", { type: "feature", parentId: id("e1"), sortKey: "c" }),
    ]);
    expect(ids(tree)).toEqual([["e1", ["f1", "f2"]], "e2"]);
  });

  it("treats an item whose parent is missing as a root", () => {
    expect(ids(buildTree([item("orphan", { parentId: id("gone") })]))).toEqual(["orphan"]);
  });

  it("carries effective priority and area per node", () => {
    const [root] = buildTree([
      item("root", { priority: "p1", area: "work" }),
      item("child", { type: "feature", parentId: id("root") }),
    ]);
    expect(root?.priority).toEqual({ priority: "p1", inherited: false });
    expect(root?.children[0]?.priority).toEqual({ priority: "p1", inherited: true });
    expect(root?.children[0]?.area).toEqual({ area: "work", inherited: true });
  });
});

describe("filterTree", () => {
  const tree = buildTree([
    item("work", { area: "work", type: "objective" }),
    item("epic", { parentId: id("work"), sortKey: "c" }),
    item("bug", { type: "bug", parentId: id("epic"), state: "in-progress" }),
    item("other", { parentId: id("work"), sortKey: "t" }),
    item("home", { area: "personal", type: "objective" }),
  ]);

  it("keeps the ancestors of a match and drops unrelated branches", () => {
    expect(ids(filterTree(tree, { type: "bug" }))).toEqual([["work", [["epic", ["bug"]]]]]);
  });

  it("matches on the inherited area", () => {
    expect(ids(filterTree(tree, { area: "personal" }))).toEqual(["home"]);
  });

  it("combines filters", () => {
    expect(ids(filterTree(tree, { area: "work", state: "in-progress" }))).toEqual([
      ["work", [["epic", ["bug"]]]],
    ]);
  });

  it("returns the tree unchanged with no filters", () => {
    expect(filterTree(tree, {})).toBe(tree);
  });
});

describe("boardColumns", () => {
  const items = [
    item("o", { type: "objective" }),
    item("e", { parentId: id("o"), state: "in-progress" }),
    item("f1", { type: "feature", parentId: id("e"), state: "done", priority: "p3" }),
    item("f2", { type: "feature", parentId: id("e"), state: "done", priority: "p0" }),
    item("elsewhere", { state: "in-review" }),
  ];

  it("splits descendants of the chosen item into the four state columns", () => {
    const columns = boardColumns(items, { underId: id("o") });
    expect(columns.backlog).toEqual([]);
    expect(columns["in-progress"].map((entry) => entry.id)).toEqual(["e"]);
    expect(columns["in-review"]).toEqual([]);
    expect(columns.done.map((entry) => entry.id)).toEqual(["f2", "f1"]);
  });

  it("includes every item when nothing is chosen", () => {
    const columns = boardColumns(items, { underId: null });
    expect(columns["in-review"].map((entry) => entry.id)).toEqual(["elsewhere"]);
    expect(columns.backlog.map((entry) => entry.id)).toEqual(["o"]);
  });
});

describe("blockedState", () => {
  const byId = roadmapItemsById([item("open"), item("finished", { state: "done" })]);

  it("is blocked by an open blocker", () => {
    const state = blockedState(item("x", { blockedBy: [id("open"), id("finished")] }), byId);
    expect(state.blocked).toBe(true);
    expect(state.blockers.map((entry) => entry.id)).toEqual(["open"]);
  });

  it("is not blocked by finished or missing blockers", () => {
    expect(blockedState(item("x", { blockedBy: [id("finished"), id("gone")] }), byId).blocked).toBe(
      false,
    );
  });

  it("is blocked by an unresolved external blocker only", () => {
    const resolved = { id: "x1", text: "Legal", resolvedAt: at };
    const unresolved = { id: "x2", text: "Vendor", resolvedAt: null };
    expect(blockedState(item("x", { externalBlockers: [resolved] }), byId).blocked).toBe(false);
    const state = blockedState(item("x", { externalBlockers: [resolved, unresolved] }), byId);
    expect(state.blocked).toBe(true);
    expect(state.externalBlockers).toEqual([unresolved]);
  });
});

describe("attachedItemFor", () => {
  it("finds the item a thread is attached to", () => {
    const items = [
      item("a"),
      item("b", { attachments: [{ thread: thread("t1"), attachedAt: at }] }),
    ];
    expect(attachedItemFor(items, thread("t1"))?.id).toBe("b");
    expect(attachedItemFor(items, thread("t2"))).toBeNull();
  });
});
