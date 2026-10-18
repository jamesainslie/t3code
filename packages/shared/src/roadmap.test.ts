import { RoadmapItemId, type RoadmapItemType } from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canParent,
  effectiveArea,
  effectivePriority,
  sortKeyBetween,
  TYPE_LEVEL,
  wouldCreateBlockerCycle,
  wouldCreateParentCycle,
  type RoadmapTreeNodeFields,
} from "./roadmap.ts";

const id = RoadmapItemId.make;

const node = (
  itemId: string,
  fields: Partial<Omit<RoadmapTreeNodeFields, "id">> = {},
): RoadmapTreeNodeFields => ({
  id: id(itemId),
  parentId: null,
  priority: null,
  area: null,
  blockedBy: [],
  ...fields,
});

const byIdOf = (...nodes: ReadonlyArray<RoadmapTreeNodeFields>) =>
  new Map(nodes.map((entry) => [entry.id, entry]));

const HIERARCHY: ReadonlyArray<RoadmapItemType> = [
  "objective",
  "key-result",
  "initiative",
  "epic",
  "feature",
  "story",
];

describe("TYPE_LEVEL", () => {
  it("orders the hierarchy from objective down, with bug and support ticket at the bottom", () => {
    expect(HIERARCHY.map((type) => TYPE_LEVEL[type])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(TYPE_LEVEL.bug).toBe(6);
    expect(TYPE_LEVEL["support-ticket"]).toBe(6);
  });
});

describe("canParent", () => {
  it.each(HIERARCHY.map((parent, index) => [parent, index] as const))(
    "%s parents every hierarchy type below it and none at or above it",
    (parent, index) => {
      for (const [childIndex, child] of HIERARCHY.entries()) {
        expect(canParent(parent, child)).toBe(childIndex > index);
      }
    },
  );

  it("bug and support ticket sit only under epic, feature or story", () => {
    for (const child of ["bug", "support-ticket"] as const) {
      expect(canParent("epic", child)).toBe(true);
      expect(canParent("feature", child)).toBe(true);
      expect(canParent("story", child)).toBe(true);
      expect(canParent("objective", child)).toBe(false);
      expect(canParent("key-result", child)).toBe(false);
      expect(canParent("initiative", child)).toBe(false);
    }
  });

  it("bug and support ticket parent nothing", () => {
    for (const parent of ["bug", "support-ticket"] as const) {
      for (const child of [...HIERARCHY, "bug", "support-ticket"] as const) {
        expect(canParent(parent, child)).toBe(false);
      }
    }
  });
});

describe("effectivePriority", () => {
  it("uses the item's own priority when set", () => {
    const byId = byIdOf(node("a", { priority: "p0" }));
    expect(effectivePriority(id("a"), byId)).toEqual({ priority: "p0", inherited: false });
  });

  it("inherits through three levels of unset priority", () => {
    const byId = byIdOf(
      node("root", { priority: "p1" }),
      node("mid", { parentId: id("root") }),
      node("low", { parentId: id("mid") }),
      node("leaf", { parentId: id("low") }),
    );
    expect(effectivePriority(id("leaf"), byId)).toEqual({ priority: "p1", inherited: true });
  });

  it("defaults a root with no priority to p2, inherited", () => {
    const byId = byIdOf(node("root"), node("leaf", { parentId: id("root") }));
    expect(effectivePriority(id("root"), byId)).toEqual({ priority: "p2", inherited: true });
    expect(effectivePriority(id("leaf"), byId)).toEqual({ priority: "p2", inherited: true });
  });

  it("treats a missing parent as a root", () => {
    const byId = byIdOf(node("orphan", { parentId: id("gone") }));
    expect(effectivePriority(id("orphan"), byId)).toEqual({ priority: "p2", inherited: true });
  });
});

describe("effectiveArea", () => {
  it("uses the item's own area when set", () => {
    const byId = byIdOf(node("a", { area: "work" }));
    expect(effectiveArea(id("a"), byId)).toEqual({ area: "work", inherited: false });
  });

  it("inherits the nearest ancestor's area", () => {
    const byId = byIdOf(
      node("root", { area: "personal" }),
      node("mid", { parentId: id("root"), area: "work" }),
      node("leaf", { parentId: id("mid") }),
    );
    expect(effectiveArea(id("leaf"), byId)).toEqual({ area: "work", inherited: true });
  });

  it("defaults a root with no area to personal", () => {
    const byId = byIdOf(node("root"));
    expect(effectiveArea(id("root"), byId)).toEqual({ area: "personal", inherited: true });
  });
});

describe("wouldCreateParentCycle", () => {
  const byId = byIdOf(
    node("a"),
    node("b", { parentId: id("a") }),
    node("c", { parentId: id("b") }),
    node("d"),
  );

  it("refuses an item as its own parent", () => {
    expect(wouldCreateParentCycle(id("a"), id("a"), byId)).toBe(true);
  });

  it("refuses moving an item under its own descendant", () => {
    expect(wouldCreateParentCycle(id("a"), id("c"), byId)).toBe(true);
  });

  it("allows moving under an unrelated item or to the root", () => {
    expect(wouldCreateParentCycle(id("c"), id("d"), byId)).toBe(false);
    expect(wouldCreateParentCycle(id("c"), null, byId)).toBe(false);
  });
});

describe("wouldCreateBlockerCycle", () => {
  const byId = byIdOf(
    node("a", { blockedBy: [id("b")] }),
    node("b", { blockedBy: [id("c")] }),
    node("c"),
    node("d"),
  );

  it("refuses an item blocking itself", () => {
    expect(wouldCreateBlockerCycle(id("a"), id("a"), byId)).toBe(true);
  });

  it("refuses a blocker that is already transitively blocked by the item", () => {
    expect(wouldCreateBlockerCycle(id("c"), id("a"), byId)).toBe(true);
  });

  it("allows an unrelated blocker", () => {
    expect(wouldCreateBlockerCycle(id("a"), id("d"), byId)).toBe(false);
    expect(wouldCreateBlockerCycle(id("d"), id("a"), byId)).toBe(false);
  });
});

describe("sortKeyBetween", () => {
  it("returns a key strictly between its neighbours", () => {
    const key = sortKeyBetween("b", "d");
    expect(key > "b" && key < "d").toBe(true);
  });

  it("returns a key below the first and above the last", () => {
    const first = sortKeyBetween(null, "m");
    expect(first < "m").toBe(true);
    const last = sortKeyBetween("m", null);
    expect(last > "m").toBe(true);
  });

  it("returns a key for an empty list", () => {
    expect(sortKeyBetween(null, null).length).toBeGreaterThan(0);
  });

  it("stays strictly ordered across 50 inserts at the same position", () => {
    const low = sortKeyBetween(null, null);
    const high = sortKeyBetween(low, null);
    let upper = high;
    const keys = [low, high];
    for (let index = 0; index < 50; index += 1) {
      const key = sortKeyBetween(low, upper);
      expect(key > low && key < upper).toBe(true);
      keys.push(key);
      upper = key;
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stays strictly ordered across 50 appends", () => {
    let previous = sortKeyBetween(null, null);
    for (let index = 0; index < 50; index += 1) {
      const key = sortKeyBetween(previous, null);
      expect(key > previous).toBe(true);
      previous = key;
    }
  });

  it("ignores an upper bound that is not above the lower bound", () => {
    const key = sortKeyBetween("m", "c");
    expect(key > "m").toBe(true);
  });
});
