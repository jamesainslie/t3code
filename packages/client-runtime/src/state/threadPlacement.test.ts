import { describe, expect, it } from "vite-plus/test";
import {
  activeThreadOrderKey,
  activeThreadOrderLowerBound,
  pinOrderKeyBetween,
  planPinnedReorder,
  sortActiveThreads,
} from "./threadSort.ts";

const thread = (id: string, day: number, pinPosition: number | null = null) => ({
  id,
  createdAt: `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  pinnedAt: pinPosition === null ? null : "2026-09-07T00:00:00.000Z",
  pinPosition,
});

describe("active sidebar placement", () => {
  it("lets new threads arrive above a manually moved first row", () => {
    const first = thread("first", 6);
    const moved = thread("moved", 3);
    const assignments = planPinnedReorder({
      orderedIds: ["moved", "first"],
      keysById: new Map([first, moved].map((item) => [item.id, activeThreadOrderKey(item)])),
      movedId: "moved",
      lowerBound: activeThreadOrderLowerBound([first, moved]),
    });
    const placed = { ...moved, threadOrderKey: assignments[0]!.orderKey };
    expect(sortActiveThreads([first, placed]).map((item) => item.id)).toEqual(["moved", "first"]);
    expect(sortActiveThreads([first, placed, thread("new", 7)]).map((item) => item.id)).toEqual([
      "new",
      "moved",
      "first",
    ]);
  });

  it("keeps new arrivals first after resolving equal neighbor keys", () => {
    const sameTime = [thread("a", 6), thread("b", 6), thread("c", 6)];
    const assignments = planPinnedReorder({
      orderedIds: ["a", "c", "b"],
      keysById: new Map(sameTime.map((item) => [item.id, activeThreadOrderKey(item)])),
      movedId: "c",
      lowerBound: activeThreadOrderLowerBound(sameTime),
    });
    const keys = new Map(assignments.map((item) => [item.id, item.orderKey]));
    const placed = sameTime.map((item) => ({ ...item, threadOrderKey: keys.get(item.id) }));
    expect(sortActiveThreads([...placed, thread("new", 7)]).map((item) => item.id)).toEqual([
      "new",
      "a",
      "c",
      "b",
    ]);
  });
  it("can arrange more than a thousand threads with identical creation times", () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `thread-${i}`);
    const assignments = planPinnedReorder({
      orderedIds: ids,
      keysById: new Map(ids.map((id) => [id, "m"])),
      movedId: ids[2]!,
    });
    const keys = assignments.map((item) => item.orderKey);
    expect(new Set(keys).size).toBe(1200);
    expect(keys).toEqual([...keys].sort());
    expect(keys.every((key) => pinOrderKeyBetween(key, null) !== null)).toBe(true);
  });
  it("persists manual order between neighboring threads", () => {
    const first = thread("first", 6);
    const second = thread("second", 5);
    const moved = {
      ...thread("moved", 3),
      threadOrderKey: pinOrderKeyBetween(activeThreadOrderKey(first), activeThreadOrderKey(second)),
    };
    expect(sortActiveThreads([second, moved, first]).map((item) => item.id)).toEqual([
      "first",
      "moved",
      "second",
    ]);
    expect(
      sortActiveThreads([second, moved, first, thread("new", 7)]).map((item) => item.id),
    ).toEqual(["new", "first", "moved", "second"]);
  });

  it("counts top pins and resolves collisions without dropping threads", () => {
    const items = [thread("b", 5, 2), thread("a", 6, 2), thread("other", 7)];
    expect(sortActiveThreads(items, 1).map((item) => item.id)).toEqual(["other", "a", "b"]);
    expect(sortActiveThreads([...items].reverse(), 1).map((item) => item.id)).toEqual([
      "other",
      "a",
      "b",
    ]);
    expect(
      sortActiveThreads([thread("fixed", 4, 20), thread("other", 7)]).map((item) => item.id),
    ).toEqual(["other", "fixed"]);
  });
  it("keeps a pin in the third slot when new threads arrive", () => {
    const original = [
      thread("first", 6),
      thread("second", 5),
      thread("fixed", 4, 2),
      thread("last", 3),
    ];
    expect(sortActiveThreads(original).map((item) => item.id)).toEqual([
      "first",
      "second",
      "fixed",
      "last",
    ]);
    expect(sortActiveThreads([...original, thread("new", 7)]).map((item) => item.id)).toEqual([
      "new",
      "first",
      "fixed",
      "second",
      "last",
    ]);
  });
});
