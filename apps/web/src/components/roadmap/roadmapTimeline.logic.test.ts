import {
  DEFAULT_ROADMAP_AREA_SETTINGS,
  type IsoDate,
  RoadmapItemId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import type {
  RoadmapTimelineLayout,
  RoadmapTimelineRow,
} from "@lathe/client-runtime/roadmap/timeline";
import { describe, expect, it } from "vite-plus/test";

import {
  TIMELINE_DAY_WIDTH as DAY,
  TIMELINE_ROW_HEIGHT as ROW,
  hiddenWithoutDatesNote,
  timelineBarGeometry,
  timelineBarTitle,
  timelineDateLabel,
  timelineDisplayRows,
  timelineEdgePaths,
  timelineMetrics,
  timelineSpan,
  timelineTodayX,
  timelineWeekTicks,
} from "./roadmapTimeline.logic";

const id = RoadmapItemId.make;
const at = (date: IsoDate) => `${date}T12:00:00.000Z`;
const dateOf = (instant: string): IsoDate => instant.slice(0, 10);

const item = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: id(itemId),
  type: "story",
  title: `Item ${itemId}`,
  description: "",
  parentId: null,
  sortKey: itemId,
  state: "in-progress",
  priority: null,
  area: "work",
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
  createdAt: at("2026-10-01"),
  updatedAt: at("2026-10-01"),
  createdBy: { _tag: "user" },
  stateChangedAt: at("2026-10-01"),
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  ...overrides,
});

const row = (overrides: Partial<RoadmapTimelineRow> = {}): RoadmapTimelineRow => ({
  itemId: id("a"),
  groupId: id("a"),
  depth: 0,
  start: 2,
  end: 4,
  due: null,
  forecast: null,
  progress: null,
  done: false,
  ...overrides,
});

const layoutOf = (overrides: Partial<RoadmapTimelineLayout>): RoadmapTimelineLayout => ({
  days: 28,
  todayOffset: null,
  groups: [],
  rows: [],
  edges: [],
  sprintBands: [],
  hiddenWithoutDates: 0,
  ...overrides,
});

describe("timelineDateLabel", () => {
  it("writes a short month and the day without padding", () => {
    expect(timelineDateLabel("2026-10-12")).toBe("Oct 12");
    expect(timelineDateLabel("2027-01-04")).toBe("Jan 4");
  });
});

describe("timelineWeekTicks", () => {
  it("labels every Monday in the range by its day offset", () => {
    expect(timelineWeekTicks({ start: "2026-10-12", end: "2026-11-01" })).toEqual([
      { offset: 0, label: "Oct 12" },
      { offset: 7, label: "Oct 19" },
      { offset: 14, label: "Oct 26" },
    ]);
  });

  it("starts at the first Monday when the range does not", () => {
    expect(timelineWeekTicks({ start: "2026-10-15", end: "2026-10-26" })).toEqual([
      { offset: 4, label: "Oct 19" },
      { offset: 11, label: "Oct 26" },
    ]);
  });
});

describe("timelineSpan", () => {
  it("covers whole days, both ends inclusive", () => {
    expect(timelineSpan(2, 4, 28)).toEqual({ left: 2 * DAY, width: 3 * DAY });
  });

  it("clips to the range and drops a span entirely outside it", () => {
    expect(timelineSpan(-3, 1, 28)).toEqual({ left: 0, width: 2 * DAY });
    expect(timelineSpan(26, 40, 28)).toEqual({ left: 26 * DAY, width: 2 * DAY });
    expect(timelineSpan(30, 32, 28)).toBeNull();
    expect(timelineSpan(-5, -1, 28)).toBeNull();
  });
});

describe("timelineTodayX", () => {
  it("sits in the middle of today's column", () => {
    expect(timelineTodayX(3)).toBe(3 * DAY + DAY / 2);
  });
});

describe("timelineBarGeometry", () => {
  it("places the due tick at the end of the due day and labels progress", () => {
    const geometry = timelineBarGeometry(row({ start: 0, end: 9, due: 9, progress: 0.624 }), 28);
    expect(geometry.bar).toEqual({ left: 0, width: 10 * DAY });
    expect(geometry.dueX).toBe(10 * DAY);
    expect(geometry.forecast).toBeNull();
    expect(geometry.label).toBe("62%");
  });

  it("runs the forecast extension from the due tick to the end of the projected day", () => {
    const geometry = timelineBarGeometry(
      row({ start: 0, end: 4, due: 4, forecast: { status: "late", end: 8 } }),
      28,
    );
    expect(geometry.forecast).toEqual({
      left: 5 * DAY,
      width: 4 * DAY,
      status: "late",
      label: "late",
    });
  });

  it("names the forecast status only when the extension has room", () => {
    const geometry = timelineBarGeometry(
      row({ start: 0, end: 4, due: 4, forecast: { status: "at-risk", end: 5 } }),
      28,
    );
    expect(geometry.forecast).toMatchObject({ width: DAY, label: null });
  });

  it("leaves out a label too wide for its bar, and one without progress", () => {
    expect(timelineBarGeometry(row({ start: 3, end: 3, progress: 0.5 }), 28).label).toBeNull();
    expect(timelineBarGeometry(row({ start: 0, end: 9, progress: null }), 28).label).toBeNull();
  });

  it("drops a due tick that falls outside the range", () => {
    expect(timelineBarGeometry(row({ start: 20, end: 30, due: 30 }), 28).dueX).toBeNull();
  });
});

describe("timelineDisplayRows", () => {
  it("uses a dated group root as its own group row", () => {
    const layout = layoutOf({
      groups: [{ rootId: id("epic"), title: "Epic", firstRow: 0, rowCount: 2 }],
      rows: [
        row({ itemId: id("epic"), groupId: id("epic") }),
        row({ itemId: id("story"), groupId: id("epic"), depth: 1 }),
      ],
    });
    expect(timelineDisplayRows(layout)).toEqual({
      rows: [
        { kind: "item", row: 0, groupHead: true },
        { kind: "item", row: 1, groupHead: false },
      ],
      displayIndexOf: [0, 1],
    });
  });

  it("adds a label-only row for a group whose root has no dates", () => {
    const layout = layoutOf({
      groups: [
        { rootId: id("one"), title: "One", firstRow: 0, rowCount: 1 },
        { rootId: id("two"), title: "Two", firstRow: 1, rowCount: 1 },
      ],
      rows: [
        row({ itemId: id("story"), groupId: id("one"), depth: 1 }),
        row({ itemId: id("two"), groupId: id("two") }),
      ],
    });
    expect(timelineDisplayRows(layout)).toEqual({
      rows: [
        { kind: "group", groupId: id("one"), title: "One" },
        { kind: "item", row: 0, groupHead: false },
        { kind: "item", row: 1, groupHead: true },
      ],
      displayIndexOf: [1, 2],
    });
  });
});

describe("timelineEdgePaths", () => {
  it("curves from the end of the blocker's bar to the start of the blocked one", () => {
    const layout = layoutOf({
      rows: [row({ start: 0, end: 4 }), row({ itemId: id("b"), start: 10, end: 12 })],
      edges: [{ from: 0, to: 1 }],
    });
    const x1 = 5 * DAY;
    const x2 = 10 * DAY;
    const y1 = ROW / 2;
    const y2 = ROW + ROW / 2;
    const bend = (x2 - x1) / 2;
    expect(timelineEdgePaths(layout, [0, 1])).toEqual([
      { key: "0-1", d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}` },
    ]);
  });

  it("keeps a visible bend when the blocked bar starts before the blocker ends", () => {
    const layout = layoutOf({
      rows: [row({ start: 0, end: 9 }), row({ itemId: id("b"), start: 9, end: 12 })],
      edges: [{ from: 0, to: 1 }],
    });
    const [path] = timelineEdgePaths(layout, [0, 2]);
    const x1 = 10 * DAY;
    const x2 = 9 * DAY;
    const y2 = 2 * ROW + ROW / 2;
    expect(path?.d).toBe(`M${x1},${ROW / 2} C${x1 + 16},${ROW / 2} ${x2 - 16},${y2} ${x2},${y2}`);
  });
});

describe("timelineBarTitle", () => {
  const range = { start: "2026-10-12", end: "2026-11-30" };

  it("spells out the dates, forecast and progress behind a bar", () => {
    expect(
      timelineBarTitle(
        "Brand layer",
        row({ start: 3, end: 18, due: 18, forecast: { status: "late", end: 21 }, progress: 0.6 }),
        range,
      ),
    ).toBe("Brand layer, Oct 15 to Oct 30, forecast Nov 2, late, 60% done");
  });

  it("says done for a finished item and leaves out what is unknown", () => {
    expect(timelineBarTitle("Icon set", row({ start: 0, end: 0, done: true }), range)).toBe(
      "Icon set, Oct 12, done",
    );
  });
});

describe("hiddenWithoutDatesNote", () => {
  it("counts the items left off, and says nothing when none are", () => {
    expect(hiddenWithoutDatesNote(0)).toBeNull();
    expect(hiddenWithoutDatesNote(1)).toBe("1 item has no dates");
    expect(hiddenWithoutDatesNote(4)).toBe("4 items have no dates");
  });
});

describe("timelineMetrics", () => {
  const TODAY = "2026-10-20";
  const settings = {
    work: DEFAULT_ROADMAP_AREA_SETTINGS,
    personal: { ...DEFAULT_ROADMAP_AREA_SETTINGS, unit: "items" as const },
  };
  // Five done one-point leaves in the window give the work area a velocity of 5 over 15 days.
  const history = ["h1", "h2", "h3", "h4", "h5"].map((key) =>
    item(key, { state: "done", estimate: 1, completedAt: at("2026-10-15") }),
  );

  it("measures progress as burned over total in the item's area unit", () => {
    const epic = item("epic", { type: "epic" });
    const items = [
      ...history,
      epic,
      item("s1", { parentId: id("epic"), area: null, estimate: 3, state: "done" }),
      item("s2", { parentId: id("epic"), area: null, estimate: 1 }),
      item("p1", { area: "personal" }),
      item("p1a", { parentId: id("p1"), area: null, state: "done" }),
      item("p1b", { parentId: id("p1"), area: null }),
    ];
    const { progress } = timelineMetrics({
      items,
      sprints: [],
      today: TODAY,
      areaSettings: settings,
      dateOf,
    });
    expect(progress.get(id("epic"))).toBe(0.75);
    expect(progress.get(id("p1"))).toBe(0.5);
  });

  it("counts a done item as complete and leaves out one with nothing to burn against", () => {
    const items = [item("done", { state: "done" }), item("open")];
    const { progress } = timelineMetrics({
      items,
      sprints: [],
      today: TODAY,
      areaSettings: settings,
      dateOf,
    });
    expect(progress.get(id("done"))).toBe(1);
    expect(progress.has(id("open"))).toBe(false);
  });

  it("forecasts from the area's velocity", () => {
    const late = item("late", { estimate: 3, dueDate: "2026-10-21" });
    const { forecasts } = timelineMetrics({
      items: [...history, late],
      sprints: [],
      today: TODAY,
      areaSettings: settings,
      dateOf,
    });
    // 3 points at a third of a point a day is 9 working days from Tue 20 Oct.
    expect(forecasts.get(id("late"))).toMatchObject({ status: "late", projected: "2026-11-02" });
  });
});
