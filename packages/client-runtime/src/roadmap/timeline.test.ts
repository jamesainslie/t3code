import {
  type IsoDate,
  RoadmapItemId,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import type { RoadmapForecast } from "@lathe/shared/roadmapCalc";
import { describe, expect, it } from "vite-plus/test";

import { defaultTimelineRange, layoutTimeline, type RoadmapTimelineInput } from "./timeline.ts";

const id = RoadmapItemId.make;
const TODAY = "2026-10-20";
// A Monday, so offset 0 is 19 October.
const RANGE = { start: "2026-10-19", end: "2026-11-15" };
const at = (date: IsoDate) => `${date}T12:00:00.000Z`;

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
  focusedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
  ...overrides,
});

const sprint = (sprintId: string, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint => ({
  id: RoadmapSprintId.make(sprintId),
  name: `Sprint ${sprintId}`,
  area: "work",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  ...overrides,
});

const layout = (
  items: ReadonlyArray<RoadmapWorkItem>,
  overrides: Partial<RoadmapTimelineInput> = {},
) =>
  layoutTimeline({
    items,
    sprints: [],
    today: TODAY,
    forecasts: new Map(),
    range: RANGE,
    ...overrides,
  });

describe("layoutTimeline", () => {
  it("groups dated rows under their top ancestor in tree order, with depth", () => {
    const result = layout([
      item("objective", { type: "objective", sortKey: "a" }),
      item("epic", { type: "epic", parentId: id("objective"), area: null, dueDate: "2026-10-30" }),
      item("story", {
        parentId: id("epic"),
        area: null,
        startDate: "2026-10-21",
        dueDate: "2026-10-23",
      }),
      item("undated", { parentId: id("epic"), area: null }),
      item("loose", { sortKey: "b", startDate: "2026-10-26", dueDate: "2026-10-28" }),
    ]);
    expect(result.groups).toEqual([
      { rootId: "objective", title: "Item objective", firstRow: 0, rowCount: 2 },
      { rootId: "loose", title: "Item loose", firstRow: 2, rowCount: 1 },
    ]);
    expect(result.rows.map((row) => [row.itemId, row.groupId, row.depth])).toEqual([
      ["epic", "objective", 1],
      ["story", "objective", 2],
      ["loose", "loose", 0],
    ]);
    expect(result.hiddenWithoutDates).toBe(2);
    expect(result.days).toBe(28);
    expect(result.todayOffset).toBe(1);
  });

  it("runs a bar from its start, or the earlier of created and due, to the due date", () => {
    const result = layout([
      item("started", { startDate: "2026-10-21", dueDate: "2026-10-23" }),
      item("created-first", { createdAt: at("2026-10-01"), dueDate: "2026-10-23" }),
      item("created-after-due", { createdAt: at("2026-10-28"), dueDate: "2026-10-23" }),
    ]);
    expect(result.rows.map((row) => [row.itemId, row.start, row.end, row.due])).toEqual([
      ["created-after-due", 4, 4, 4],
      ["created-first", -18, 4, 4],
      ["started", 2, 4, 4],
    ]);
  });

  it("ends an item with only a start date at its forecast, else at the start", () => {
    const forecast: RoadmapForecast = {
      status: "on-track",
      projected: "2026-10-27",
      slackDays: null,
    };
    const result = layout(
      [item("a", { startDate: "2026-10-21" }), item("b", { startDate: "2026-10-22" })],
      { forecasts: new Map([[id("a"), forecast]]) },
    );
    expect(
      result.rows.map((row) => [row.itemId, row.start, row.end, row.due, row.forecast]),
    ).toEqual([
      ["a", 2, 8, null, null],
      ["b", 3, 3, null, null],
    ]);
  });

  it("extends a bar past its due date to a later forecast", () => {
    const late: RoadmapForecast = { status: "late", projected: "2026-10-28", slackDays: -3 };
    const onTrack: RoadmapForecast = { status: "on-track", projected: "2026-10-21", slackDays: 2 };
    const result = layout(
      [
        item("late", { startDate: "2026-10-19", dueDate: "2026-10-23" }),
        item("fine", { startDate: "2026-10-19", dueDate: "2026-10-23" }),
      ],
      {
        forecasts: new Map([
          [id("late"), late],
          [id("fine"), onTrack],
        ]),
      },
    );
    expect(result.rows.map((row) => [row.itemId, row.forecast])).toEqual([
      ["fine", null],
      ["late", { status: "late", end: 9 }],
    ]);
  });

  it("draws blocker edges between rows, skipping blockers without a row", () => {
    const result = layout([
      item("a", { dueDate: "2026-10-23" }),
      item("b", { dueDate: "2026-10-27", blockedBy: [id("a"), id("undated")] }),
      item("undated"),
    ]);
    expect(result.edges).toEqual([{ from: 0, to: 1 }]);
  });

  it("places sprint bands and the today line, and passes progress and done through", () => {
    const result = layout([item("a", { dueDate: "2026-10-23", state: "done" })], {
      sprints: [sprint("s1"), sprint("s2", { startDate: "2026-11-02", endDate: "2026-11-13" })],
      progress: new Map([[id("a"), 0.5]]),
    });
    expect(result.sprintBands).toEqual([
      { sprintId: "s1", name: "Sprint s1", area: "work", start: 0, end: 11 },
      { sprintId: "s2", name: "Sprint s2", area: "work", start: 14, end: 25 },
    ]);
    expect(result.rows[0]).toMatchObject({ progress: 0.5, done: true });
    expect(layout([], { today: "2026-12-25" }).todayOffset).toBeNull();
  });

  it("filters rows, hidden counts and sprints by area", () => {
    const result = layout(
      [
        item("work", { dueDate: "2026-10-23" }),
        item("home", { area: "personal", dueDate: "2026-10-23" }),
        item("home-undated", { area: "personal" }),
        item("work-undated"),
      ],
      {
        area: "personal",
        sprints: [sprint("w"), sprint("p", { area: "personal" })],
      },
    );
    expect(result.rows.map((row) => row.itemId)).toEqual(["home"]);
    expect(result.hiddenWithoutDates).toBe(1);
    expect(result.sprintBands.map((band) => band.sprintId)).toEqual(["p"]);
  });

  it("groups under the top ancestor the area filter shows", () => {
    const result = layout(
      [
        item("home", { type: "objective", area: "personal" }),
        item("job", { type: "epic", parentId: id("home"), sortKey: "a", dueDate: "2026-10-23" }),
        item("job-story", { parentId: id("job"), area: null, dueDate: "2026-10-22" }),
        item("side", { type: "epic", parentId: id("home"), sortKey: "b", dueDate: "2026-10-30" }),
      ],
      { area: "work" },
    );
    expect(result.groups.map((group) => [group.rootId, group.rowCount])).toEqual([
      ["job", 2],
      ["side", 1],
    ]);
    expect(result.rows.map((row) => [row.itemId, row.depth])).toEqual([
      ["job", 0],
      ["job-story", 1],
      ["side", 0],
    ]);
    expect(result.hiddenWithoutDates).toBe(0);
  });
});

describe("defaultTimelineRange", () => {
  it("spans the dated work and forecasts, from a Monday, with room either side", () => {
    const late: RoadmapForecast = { status: "late", projected: "2026-11-20", slackDays: -5 };
    expect(
      defaultTimelineRange({
        items: [
          item("a", { startDate: "2026-10-14", dueDate: "2026-10-30" }),
          item("b", { dueDate: "2026-11-13" }),
        ],
        forecasts: new Map([[id("b"), late]]),
        today: TODAY,
      }),
    ).toEqual({ start: "2026-09-21", end: "2026-12-04" });
  });

  it("shows the weeks around today when nothing has dates", () => {
    expect(
      defaultTimelineRange({ items: [item("a")], forecasts: new Map(), today: TODAY }),
    ).toEqual({ start: "2026-10-12", end: "2026-11-17" });
  });
});
