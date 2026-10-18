import { CommandId, RoadmapItemId, type RoadmapWorkItem } from "@lathe/contracts";
import { buildTree, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { describe, expect, it } from "vite-plus/test";

import {
  activeRoadmapFilters,
  ancestorIds,
  boardDueLabel,
  boardUnderOptions,
  buildCreateCommand,
  buildEditCommands,
  canHaveChildren,
  defaultTypeFor,
  editorDraftFor,
  emptyEditorDraft,
  filterOutlineTree,
  flattenOutline,
  formatRoadmapDate,
  outlineDropZone,
  resolveOutlineDrop,
  roadmapEditorRequest,
  typeOptionsFor,
  validateRoadmapSearch,
  withoutEditorRequest,
} from "./roadmapPage.logic";

const at = "2026-10-18T09:00:00.000Z";
const id = RoadmapItemId.make;

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

describe("validateRoadmapSearch", () => {
  it("keeps known values and drops unknown ones", () => {
    expect(
      validateRoadmapSearch({
        view: "board",
        item: "item-1",
        area: "work",
        type: "story",
        itemState: "open",
        under: "epic-1",
        bogus: "x",
      }),
    ).toEqual({
      view: "board",
      item: id("item-1"),
      area: "work",
      type: "story",
      itemState: "open",
      under: id("epic-1"),
    });
    expect(
      validateRoadmapSearch({ view: "timeline", area: "home", type: "task", itemState: "blocked" }),
    ).toEqual({});
  });

  it("reads new=1 in every form the URL parser can produce", () => {
    for (const value of [1, "1", true, "true"]) {
      expect(validateRoadmapSearch({ new: value })).toEqual({ new: 1 });
    }
    expect(validateRoadmapSearch({ new: 0 })).toEqual({});
    expect(validateRoadmapSearch({ new: "no" })).toEqual({});
  });

  it("keeps parent only alongside new", () => {
    expect(validateRoadmapSearch({ new: 1, parent: "epic-1" })).toEqual({
      new: 1,
      parent: id("epic-1"),
    });
    expect(validateRoadmapSearch({ parent: "epic-1" })).toEqual({});
    expect(validateRoadmapSearch({ new: 1, parent: "   " })).toEqual({ new: 1 });
  });

  it("reads an id the URL parser turned into a number as a string", () => {
    expect(validateRoadmapSearch({ new: 1, parent: 42, item: 7 })).toEqual({
      new: 1,
      parent: id("42"),
      item: id("7"),
    });
  });
});

describe("roadmapEditorRequest", () => {
  const byId = roadmapItemsById([item("epic-1")]);

  it("asks for an editor with the parent preset when the parent exists", () => {
    expect(roadmapEditorRequest({ new: 1, parent: id("epic-1") }, byId)).toEqual({
      parentId: id("epic-1"),
    });
  });

  it("opens a root editor when no parent is given or the parent is unknown", () => {
    expect(roadmapEditorRequest({ new: 1 }, byId)).toEqual({ parentId: null });
    expect(roadmapEditorRequest({ new: 1, parent: id("gone") }, byId)).toEqual({
      parentId: null,
    });
  });

  it("asks for nothing without new", () => {
    expect(roadmapEditorRequest({ view: "board" }, byId)).toBeNull();
  });

  it("clears both params and keeps the rest", () => {
    expect(withoutEditorRequest({ view: "board", new: 1, parent: id("epic-1") })).toEqual({
      view: "board",
    });
  });
});

describe("activeRoadmapFilters", () => {
  it("lists the filters that narrow the view", () => {
    expect(activeRoadmapFilters({})).toEqual([]);
    expect(activeRoadmapFilters({ area: "work", itemState: "open", view: "board" })).toEqual([
      "area",
      "itemState",
    ]);
  });
});

describe("filterOutlineTree", () => {
  const items = [
    item("obj", { type: "objective", area: "work" }),
    item("epic", { parentId: id("obj"), state: "in-progress" }),
    item("done", { type: "story", parentId: id("epic"), state: "done" }),
    item("open", { type: "story", parentId: id("epic"), state: "backlog", sortKey: "o" }),
  ];
  const tree = buildTree(items);
  const flat = (nodes: ReturnType<typeof buildTree>): Array<string> =>
    nodes.flatMap((node) => [node.item.id, ...flat(node.children)]);

  it("returns the tree untouched with no filters", () => {
    expect(filterOutlineTree(tree, {})).toBe(tree);
  });

  it("treats open as every state but done", () => {
    expect(flat(filterOutlineTree(tree, { state: "open" }))).toEqual(["obj", "epic", "open"]);
  });

  it("keeps ancestors of a match that do not match themselves", () => {
    expect(flat(filterOutlineTree(tree, { state: "done" }))).toEqual(["obj", "epic", "done"]);
    expect(flat(filterOutlineTree(tree, { type: "story", area: "work" }))).toEqual([
      "obj",
      "epic",
      "done",
      "open",
    ]);
    expect(flat(filterOutlineTree(tree, { area: "personal" }))).toEqual([]);
  });
});

describe("type rules", () => {
  it("offers only types that fit under the parent and over the children", () => {
    expect(typeOptionsFor(null, [])).toHaveLength(8);
    expect(typeOptionsFor("epic", [])).toEqual(["feature", "story", "bug", "support-ticket"]);
    expect(typeOptionsFor("objective", ["feature"])).toEqual(["key-result", "initiative", "epic"]);
    expect(typeOptionsFor("story", ["bug"])).toEqual([]);
  });

  it("picks the first type that fits under a parent", () => {
    expect(defaultTypeFor(null)).toBe("objective");
    expect(defaultTypeFor("objective")).toBe("key-result");
    expect(defaultTypeFor("feature")).toBe("story");
    expect(defaultTypeFor("story")).toBe("bug");
  });

  it("knows which types can hold children", () => {
    expect(canHaveChildren("story")).toBe(true);
    expect(canHaveChildren("bug")).toBe(false);
    expect(canHaveChildren("support-ticket")).toBe(false);
  });
});

describe("flattenOutline", () => {
  const items = [
    item("a", { type: "objective", sortKey: "a" }),
    item("a1", { parentId: id("a"), sortKey: "a" }),
    item("a1x", { type: "story", parentId: id("a1") }),
    item("b", { type: "objective", sortKey: "b" }),
  ];
  const tree = buildTree(items);
  const rows = (collapsed: ReadonlyArray<string>, expandAll = false) =>
    flattenOutline(tree, new Set(collapsed.map((value) => id(value))), expandAll).map(
      (row) =>
        `${row.depth}:${row.node.item.id}${row.hasChildren ? (row.expanded ? "-" : "+") : ""}`,
    );

  it("lists rows depth first with their depth", () => {
    expect(rows([])).toEqual(["0:a-", "1:a1-", "2:a1x", "0:b"]);
  });

  it("hides the subtree of a collapsed row", () => {
    expect(rows(["a1"])).toEqual(["0:a-", "1:a1+", "0:b"]);
    expect(rows(["a"])).toEqual(["0:a+", "0:b"]);
  });

  it("ignores collapse when told to expand everything", () => {
    expect(rows(["a"], true)).toEqual(["0:a-", "1:a1-", "2:a1x", "0:b"]);
  });
});

describe("ancestorIds", () => {
  it("lists ancestors nearest first and survives a loop", () => {
    const byId = roadmapItemsById([
      item("root"),
      item("mid", { parentId: id("root") }),
      item("leaf", { parentId: id("mid") }),
      item("x", { parentId: id("y") }),
      item("y", { parentId: id("x") }),
    ]);
    expect(ancestorIds(id("leaf"), byId)).toEqual([id("mid"), id("root")]);
    expect(ancestorIds(id("root"), byId)).toEqual([]);
    expect(ancestorIds(id("x"), byId)).toEqual([id("y")]);
  });
});

describe("outline drag", () => {
  it("splits a row into thirds when nesting is allowed and halves when not", () => {
    expect(outlineDropZone(0.1, true)).toBe("before");
    expect(outlineDropZone(0.5, true)).toBe("inside");
    expect(outlineDropZone(0.9, true)).toBe("after");
    expect(outlineDropZone(0.4, false)).toBe("before");
    expect(outlineDropZone(0.6, false)).toBe("after");
  });

  const items = [
    item("obj", { type: "objective", sortKey: "a" }),
    item("obj2", { type: "objective", sortKey: "b" }),
    item("epic1", { parentId: id("obj"), sortKey: "a" }),
    item("epic2", { parentId: id("obj"), sortKey: "b" }),
    item("epic3", { parentId: id("obj"), sortKey: "c" }),
    item("story", { type: "story", parentId: id("epic1") }),
  ];

  it("places an item before or after a sibling of the target", () => {
    expect(resolveOutlineDrop(items, id("epic3"), id("epic1"), "before")).toEqual({
      parentId: id("obj"),
      beforeId: id("epic1"),
    });
    expect(resolveOutlineDrop(items, id("epic1"), id("epic3"), "after")).toEqual({
      parentId: id("obj"),
      afterId: id("epic3"),
    });
  });

  it("nests an item inside the target as its last child", () => {
    expect(resolveOutlineDrop(items, id("epic3"), id("obj2"), "inside")).toEqual({
      parentId: id("obj2"),
    });
  });

  it("refuses a drop that changes nothing", () => {
    expect(resolveOutlineDrop(items, id("epic1"), id("epic1"), "before")).toBeNull();
    expect(resolveOutlineDrop(items, id("epic1"), id("epic2"), "before")).toBeNull();
    expect(resolveOutlineDrop(items, id("epic2"), id("epic1"), "after")).toBeNull();
    expect(resolveOutlineDrop(items, id("epic3"), id("obj"), "inside")).toBeNull();
  });

  it("refuses a drop under the item's own descendant", () => {
    expect(resolveOutlineDrop(items, id("obj"), id("story"), "after")).toBeNull();
    expect(resolveOutlineDrop(items, id("obj"), id("epic2"), "inside")).toBeNull();
  });

  it("refuses a parent the type rules forbid", () => {
    expect(resolveOutlineDrop(items, id("obj2"), id("epic1"), "inside")).toBeNull();
    expect(resolveOutlineDrop(items, id("epic1"), id("story"), "before")).toBeNull();
  });

  it("moves a root between roots", () => {
    expect(resolveOutlineDrop(items, id("obj2"), id("obj"), "before")).toEqual({
      parentId: null,
      beforeId: id("obj"),
    });
  });
});

describe("dates", () => {
  // 2026-10-19 is a Monday.
  it("labels a card's due date by working days left", () => {
    const today = "2026-10-19";
    expect(boardDueLabel(item("x", { dueDate: "2026-10-28" }), today)).toEqual({
      date: "Oct 28",
      left: "7 wd",
      tone: "default",
    });
    expect(boardDueLabel(item("x", { dueDate: "2026-10-19" }), today).left).toBe("due today");
    expect(boardDueLabel(item("x", { dueDate: "2026-10-15" }), today)).toMatchObject({
      left: "2 wd late",
      tone: "late",
    });
    expect(boardDueLabel(item("x", { dueDate: "2026-10-15", state: "done" }), today)).toMatchObject(
      { left: "done", tone: "done" },
    );
    expect(boardDueLabel(item("x"), today)).toEqual({ date: null, left: null, tone: "default" });
  });

  it("formats a date briefly and adds the year only when it differs", () => {
    expect(formatRoadmapDate("2026-10-21", "2026-10-19")).toBe("Oct 21");
    expect(formatRoadmapDate("2027-01-04", "2026-10-19")).toBe("Jan 4, 2027");
  });
});

describe("boardUnderOptions", () => {
  it("offers objectives and epics in tree order", () => {
    const items = [
      item("obj-b", { type: "objective", sortKey: "b", title: "B" }),
      item("obj-a", { type: "objective", sortKey: "a", title: "A" }),
      item("kr", { type: "key-result", parentId: id("obj-a") }),
      item("epic", { parentId: id("kr"), title: "E" }),
      item("story", { type: "story", parentId: id("epic") }),
    ];
    expect(boardUnderOptions(items).map((option) => [option.id, option.depth])).toEqual([
      [id("obj-a"), 0],
      [id("epic"), 1],
      [id("obj-b"), 0],
    ]);
  });
});

describe("editor commands", () => {
  const commandId = CommandId.make("cmd-1");
  const ids = { itemId: id("new-1"), commandId };

  it("refuses to create without a title", () => {
    expect(buildCreateCommand({ ...emptyEditorDraft(null), title: "  " }, ids)).toEqual({
      error: "Give the work item a title.",
    });
  });

  it("builds a create command and leaves unset fields out", () => {
    const draft = {
      ...emptyEditorDraft(id("epic-1"), "epic"),
      title: "  Ship it ",
      criteriaText: "First\n\n  Second  \n",
    };
    expect(buildCreateCommand(draft, ids)).toEqual({
      command: {
        type: "roadmap.item.create",
        commandId,
        itemId: id("new-1"),
        itemType: "feature",
        title: "Ship it",
        parentId: id("epic-1"),
        criteria: [{ text: "First" }, { text: "Second" }],
      },
    });
  });

  it("carries every set field", () => {
    const draft = {
      ...emptyEditorDraft(null),
      title: "Root",
      description: "Why",
      area: "work" as const,
      priority: "p1" as const,
      dueDate: "2026-11-30",
      estimate: 3,
    };
    expect(buildCreateCommand(draft, ids)).toMatchObject({
      command: {
        itemType: "objective",
        parentId: null,
        description: "Why",
        area: "work",
        priority: "p1",
        dueDate: "2026-11-30",
        estimate: 3,
      },
    });
  });

  it("edits only what changed and keeps criteria ids for unchanged text", () => {
    const existing = item("x", {
      type: "feature",
      parentId: id("epic-1"),
      title: "Old",
      priority: "p2",
      criteria: [
        { id: "c1", text: "Keep", tickedAt: at, tickedBy: { _tag: "user" }, evidence: null },
        { id: "c2", text: "Drop", tickedAt: null, tickedBy: null, evidence: null },
      ],
    });
    let counter = 0;
    const next = () => CommandId.make(`cmd-${++counter}`);
    const draft = {
      ...editorDraftFor(existing),
      title: "New",
      priority: null,
      parentId: id("epic-2"),
      criteriaText: "Keep\nAdd",
    };
    expect(buildEditCommands(existing, draft, next)).toEqual({
      commands: [
        {
          type: "roadmap.item.update",
          commandId: CommandId.make("cmd-1"),
          itemId: id("x"),
          patch: { title: "New", priority: null },
        },
        {
          type: "roadmap.item.move",
          commandId: CommandId.make("cmd-2"),
          itemId: id("x"),
          parentId: id("epic-2"),
        },
        {
          type: "roadmap.criteria.set",
          commandId: CommandId.make("cmd-3"),
          itemId: id("x"),
          criteria: [{ id: "c1", text: "Keep" }, { text: "Add" }],
        },
      ],
    });
  });

  it("sends nothing when nothing changed", () => {
    const existing = item("x", { title: "Same" });
    expect(
      buildEditCommands(existing, editorDraftFor(existing), () => CommandId.make("c")),
    ).toEqual({
      commands: [],
    });
  });
});
