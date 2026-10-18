import {
  DEFAULT_ROADMAP_AREA_SETTINGS,
  EnvironmentId,
  type IsoDate,
  type RoadmapArea,
  type RoadmapAreaSettings,
  RoadmapItemId,
  type RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildToday,
  type RoadmapThreadSignal,
  type RoadmapToday,
  type RoadmapTodayInput,
} from "./today.ts";

const id = RoadmapItemId.make;
// A Tuesday.
const TODAY = "2026-10-20";
const NOW = "2026-10-20T15:00:00.000Z";
const at = (date: IsoDate, time = "12:00:00.000") => `${date}T${time}Z`;
const thread = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("t1") };

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
  createdAt: at("2026-09-01"),
  updatedAt: at("2026-10-19"),
  createdBy: { _tag: "user" },
  // Recent enough that nothing goes cold unless a test says so.
  stateChangedAt: at("2026-10-19"),
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  ...overrides,
});

/** Five done leaves of `size` points each in the trailing window: velocity of size / 3 per day. */
const history = (area: RoadmapArea, size: number) =>
  ["2026-10-01", "2026-10-06", "2026-10-09", "2026-10-14", "2026-10-16"].map((date, index) =>
    item(`${area}-done-${index}`, {
      area,
      state: "done",
      estimate: size,
      completedAt: at(date),
      stateChangedAt: at(date),
    }),
  );

const areaSettings = (
  overrides: Partial<Record<RoadmapArea, Partial<RoadmapAreaSettings>>> = {},
): Readonly<Record<RoadmapArea, RoadmapAreaSettings>> => ({
  work: { ...DEFAULT_ROADMAP_AREA_SETTINGS, ...overrides.work },
  personal: { ...DEFAULT_ROADMAP_AREA_SETTINGS, ...overrides.personal },
});

const build = (
  items: ReadonlyArray<RoadmapWorkItem>,
  overrides: Partial<RoadmapTodayInput> = {},
): RoadmapToday =>
  buildToday({
    items,
    sprints: [],
    areaSettings: areaSettings(),
    threadSignals: new Map(),
    reviewRequests: new Map(),
    lastOpenedAt: null,
    today: TODAY,
    now: NOW,
    ...overrides,
  });

const sectionsOf = (today: RoadmapToday) =>
  today.sections.map((section) => [section.id, section.rows.map((row) => row.itemId)]);
const rowOf = (today: RoadmapToday, itemId: string) =>
  today.sections.flatMap((section) => section.rows).find((row) => row.itemId === itemId);

const signal = (overrides: Partial<RoadmapThreadSignal> = {}): RoadmapThreadSignal => ({
  latestActivityAt: null,
  awaiting: null,
  ...overrides,
});

describe("buildToday sections", () => {
  it("lists sections in order, each item once, in its first matching section", () => {
    const today = build(
      [
        item("held", { blockedBy: [], state: "in-progress" }),
        item("blocked-by-held", { blockedBy: [id("held")] }),
        item("cold", { priority: "p0", stateChangedAt: at("2026-10-01") }),
        item("due", { dueDate: "2026-10-22" }),
        item("pinned-and-due", { pinnedAt: at("2026-10-19"), dueDate: "2026-10-16" }),
        item("waiting", { pinnedAt: at("2026-10-19") }),
      ],
      {
        threadSignals: new Map([
          [id("waiting"), signal({ awaiting: { reason: "approval", thread } })],
        ]),
      },
    );
    expect(sectionsOf(today)).toEqual([
      ["waiting", ["waiting"]],
      ["picks", ["pinned-and-due"]],
      ["due", ["due"]],
      ["cold", ["cold"]],
      ["holding", ["held"]],
    ]);
    expect(today.sections.map((section) => section.title)).toEqual([
      "Waiting on you",
      "Your picks",
      "Due or slipping",
      "Going cold",
      "Holding others up",
    ]);
  });

  it("leaves out done and snoozed items, listing the snoozed ones apart", () => {
    const today = build([
      item("done", { state: "done", priority: "p0", dueDate: "2026-10-16" }),
      item("later", { snoozedUntil: "2026-10-23", dueDate: "2026-10-16" }),
      item("soon", { snoozedUntil: "2026-10-21", priority: "p0", sortKey: "z" }),
      item("woke", { snoozedUntil: TODAY, dueDate: "2026-10-16" }),
    ]);
    expect(sectionsOf(today)).toEqual([["due", ["woke"]]]);
    expect(today.snoozed).toEqual([
      { itemId: "soon", until: "2026-10-21" },
      { itemId: "later", until: "2026-10-23" },
    ]);
  });

  it("leaves out backlog items with no due date below P1, except picks and waiting", () => {
    const stale = at("2026-09-01");
    const today = build(
      [
        item("backlog-p2", { state: "backlog", priority: "p2", stateChangedAt: stale }),
        item("backlog-p1", { state: "backlog", priority: "p1", stateChangedAt: stale }),
        item("backlog-p3-due", { state: "backlog", priority: "p3", dueDate: "2026-10-21" }),
        item("backlog-pick", { state: "backlog", priority: "p3", pinnedAt: stale }),
        item("backlog-waiting", { state: "backlog", priority: "p3" }),
      ],
      { reviewRequests: new Map([[id("backlog-waiting"), ["https://github.com/o/r/pull/1"]]]) },
    );
    expect(sectionsOf(today)).toEqual([
      ["waiting", ["backlog-waiting"]],
      ["picks", ["backlog-pick"]],
      ["due", ["backlog-p3-due"]],
      ["cold", ["backlog-p1"]],
    ]);
  });

  it("orders rows within a section by rank", () => {
    const today = build([
      item("p1-late", { priority: "p1", stateChangedAt: at("2026-09-01"), sortKey: "a" }),
      item("p0", { priority: "p0", stateChangedAt: at("2026-09-01"), sortKey: "z" }),
    ]);
    expect(sectionsOf(today)).toEqual([["cold", ["p0", "p1-late"]]]);
  });
});

describe("waiting on you", () => {
  it("says why a thread waits, and counts review requests", () => {
    const today = build(
      [item("approve"), item("question"), item("plan"), item("finished"), item("review")],
      {
        threadSignals: new Map([
          [id("approve"), signal({ awaiting: { reason: "approval", thread } })],
          [id("question"), signal({ awaiting: { reason: "user-input", thread } })],
          [id("plan"), signal({ awaiting: { reason: "plan-ready", thread } })],
          [id("finished"), signal({ awaiting: { reason: "turn-finished", thread } })],
        ]),
        reviewRequests: new Map([
          [id("review"), ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"]],
          [id("question"), ["https://github.com/o/r/pull/3"]],
        ]),
      },
    );
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["approve", "Waiting for your approval"],
      ["finished", "Turn finished, waiting for you"],
      ["plan", "Plan ready for your review"],
      ["question", "Asked you a question, and 1 pull request to review"],
      ["review", "2 pull requests to review"],
    ]);
  });

  it("is outside the capacity count", () => {
    const today = build([...history("work", 3), item("busy", { estimate: 9 })], {
      threadSignals: new Map([[id("busy"), signal({ awaiting: { reason: "approval", thread } })]]),
    });
    expect(rowOf(today, "busy")?.beyondToday).toBe(false);
    expect(today.capacity.work.used).toBe(0);
  });
});

describe("due or slipping", () => {
  it("names overdue items and items due within three working days", () => {
    const today = build([
      item("overdue", { dueDate: "2026-10-16", sortKey: "a" }),
      item("today", { dueDate: TODAY, sortKey: "b" }),
      item("thursday", { dueDate: "2026-10-22", sortKey: "c" }),
      item("friday", { dueDate: "2026-10-23", sortKey: "d" }),
      item("next-week", { dueDate: "2026-10-27", sortKey: "e" }),
    ]);
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["overdue", "Overdue, was due Fri"],
      ["today", "Due today"],
      ["thursday", "Due Thu"],
      ["friday", "Due Fri"],
    ]);
  });

  it("adds items forecast at risk or late, with the forecast in the reason", () => {
    // Velocity is two points a day.
    const today = build([
      ...history("work", 6),
      item("on-track", { estimate: 6, dueDate: "2026-10-30" }),
      item("at-risk", { estimate: 14, dueDate: "2026-10-30" }),
      item("late", { estimate: 20, dueDate: "2026-10-30" }),
      item("soon-late", { estimate: 8, dueDate: "2026-10-22" }),
    ]);
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["at-risk", "Due Oct 30, forecast Oct 29, at risk"],
      ["late", "Due Oct 30, forecast Nov 3, late"],
      ["soon-late", "Due Thu, forecast Mon, late"],
    ]);
  });
});

describe("going cold", () => {
  it("lists P0 and P1 items untouched for the area's going-cold days", () => {
    const today = build([
      item("six", { priority: "p0", stateChangedAt: at("2026-10-12") }),
      item("five", { priority: "p1", stateChangedAt: at("2026-10-13") }),
      item("four", { priority: "p1", stateChangedAt: at("2026-10-14") }),
      item("p2", { priority: "p2", stateChangedAt: at("2026-09-01") }),
    ]);
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["six", "P0, untouched 6 working days"],
      ["five", "P1, untouched 5 working days"],
    ]);
    const stricter = build([item("four", { priority: "p1", stateChangedAt: at("2026-10-14") })], {
      areaSettings: areaSettings({ work: { goingColdDays: 3 } }),
    });
    expect(stricter.sections[0]?.rows[0]?.reason).toBe("P1, untouched 4 working days");
  });

  it("stays warm from ticks, hours, attached threads and work underneath", () => {
    const old = at("2026-09-01");
    const today = build(
      [
        item("ticked", {
          priority: "p0",
          stateChangedAt: old,
          criteria: [
            {
              id: "c",
              text: "c",
              tickedAt: at("2026-10-19"),
              tickedBy: { _tag: "user" },
              evidence: null,
            },
          ],
        }),
        item("logged", {
          priority: "p0",
          stateChangedAt: old,
          hours: [{ id: "h", at: at("2026-10-19"), hours: 1, actor: { _tag: "user" }, note: null }],
        }),
        item("threaded", { priority: "p0", stateChangedAt: old }),
        item("parent", { type: "epic", priority: "p0", stateChangedAt: old }),
        item("child", { parentId: id("parent"), area: null, priority: "p3" }),
      ],
      {
        threadSignals: new Map([[id("threaded"), signal({ latestActivityAt: at("2026-10-20") })]]),
      },
    );
    expect(today.sections).toEqual([]);
  });
});

describe("newly unblocked", () => {
  const blocker = (date: IsoDate, time = "10:00:00.000") =>
    item("blocker", { state: "done", completedAt: at(date, time), title: "Auth API" });

  it("lists items whose last blocker cleared since Today was last opened", () => {
    const today = build(
      [
        blocker("2026-10-20"),
        item("freed", { blockedBy: [id("blocker")] }),
        item("external", {
          externalBlockers: [{ id: "x", text: "Design sign-off", resolvedAt: at("2026-10-20") }],
        }),
      ],
      { lastOpenedAt: at("2026-10-19") },
    );
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["external", "Unblocked, Design sign-off resolved"],
      ["freed", "Unblocked, Auth API done"],
    ]);
  });

  it("ignores blockers that cleared before the last visit, and items still blocked", () => {
    const today = build(
      [
        blocker("2026-10-18"),
        item("old-news", { blockedBy: [id("blocker")] }),
        item("open-blocker", { state: "in-progress", title: "Still going" }),
        item("still-blocked", { blockedBy: [id("blocker"), id("open-blocker")] }),
      ],
      { lastOpenedAt: at("2026-10-19") },
    );
    expect(sectionsOf(today).map(([section]) => section)).not.toContain("unblocked");
  });

  it("looks back one day when Today was never opened", () => {
    const recent = build([blocker("2026-10-20"), item("freed", { blockedBy: [id("blocker")] })]);
    expect(sectionsOf(recent)).toEqual([["unblocked", ["freed"]]]);
    const older = build([
      blocker("2026-10-19", "12:00:00.000"),
      item("freed", { blockedBy: [id("blocker")] }),
    ]);
    expect(sectionsOf(older)).toEqual([]);
  });
});

describe("holding others up", () => {
  it("lists items blocking open work, most blocked and soonest due first", () => {
    const today = build([
      item("one-due-soon", { sortKey: "a" }),
      item("two", { sortKey: "b" }),
      item("one-later", { sortKey: "c" }),
      item("a", { blockedBy: [id("two")] }),
      item("b", { blockedBy: [id("two")] }),
      item("c", { blockedBy: [id("one-due-soon")], dueDate: "2026-10-23" }),
      item("d", { blockedBy: [id("one-later")], dueDate: "2026-11-30" }),
      item("e", { blockedBy: [id("two")], state: "done" }),
    ]);
    const holding = today.sections.find((section) => section.id === "holding");
    expect(holding?.rows.map((row) => [row.itemId, row.reason])).toEqual([
      ["two", "Blocks 2"],
      ["one-due-soon", "Blocks 1, next due Fri"],
      ["one-later", "Blocks 1, next due Nov 30"],
    ]);
  });
});

describe("capacity", () => {
  const stale = at("2026-09-01");
  const cold = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}) =>
    item(itemId, { priority: "p0", stateChangedAt: stale, ...overrides });

  it("fills rows in order until their estimates reach a day's velocity", () => {
    // Two points a day.
    const today = build([
      ...history("work", 6),
      cold("a", { estimate: 1 }),
      cold("b", { estimate: 1 }),
      cold("c", { estimate: 1 }),
    ]);
    expect(today.capacity.work).toEqual({ area: "work", unit: "points", perDay: 2, used: 2 });
    expect(today.sections[0]?.rows.map((row) => [row.itemId, row.beyondToday])).toEqual([
      ["a", false],
      ["b", false],
      ["c", true],
    ]);
    expect(rowOf(today, "a")).toMatchObject({ area: "work", estimate: 1, noEstimate: false });
  });

  it("counts a row with no estimate as the average done leaf, and says so", () => {
    const today = build([...history("work", 6), cold("a"), cold("b", { estimate: 1 })]);
    expect(rowOf(today, "a")).toMatchObject({
      estimate: null,
      noEstimate: true,
      beyondToday: false,
    });
    expect(today.capacity.work.used).toBe(6);
    expect(rowOf(today, "b")?.beyondToday).toBe(true);
  });

  it("keeps picks above the line even past capacity", () => {
    const pinned = at("2026-10-19");
    const today = build([
      ...history("work", 6),
      item("p1", { estimate: 1, pinnedAt: pinned }),
      item("p2", { estimate: 1, pinnedAt: pinned }),
      item("p3", { estimate: 1, pinnedAt: pinned }),
      cold("after", { estimate: 1 }),
    ]);
    expect(today.sections.flatMap((section) => section.rows).map((row) => row.beyondToday)).toEqual(
      [false, false, false, true],
    );
    expect(today.capacity.work.used).toBe(3);
  });

  it("draws no line without enough history, per area", () => {
    const today = build([
      ...history("work", 6),
      cold("w1", { estimate: 3 }),
      cold("w2", { estimate: 3 }),
      cold("home", { area: "personal", estimate: 50 }),
      cold("home2", { area: "personal", estimate: 50 }),
    ]);
    expect(today.capacity.personal).toEqual({
      area: "personal",
      unit: "points",
      perDay: null,
      used: 100,
    });
    expect(rowOf(today, "home2")?.beyondToday).toBe(false);
    expect(rowOf(today, "w2")?.beyondToday).toBe(true);
  });

  it("never counts a leaf twice when a parent and its child are both rows", () => {
    const today = build([
      ...history("work", 6),
      cold("epic", { type: "epic" }),
      cold("story", { parentId: id("epic"), area: null, estimate: 1 }),
      cold("other", { estimate: 0.5 }),
    ]);
    expect(rowOf(today, "epic")).toMatchObject({ estimate: 1, beyondToday: false });
    expect(rowOf(today, "story")?.beyondToday).toBe(false);
    expect(today.capacity.work.used).toBe(1.5);
  });

  it("counts only unfinished leaves toward a parent's estimate", () => {
    const today = build([
      cold("epic", { type: "epic", estimate: 10 }),
      cold("done-story", { parentId: id("epic"), area: null, estimate: 4, state: "done" }),
      cold("open-story", { parentId: id("epic"), area: null, estimate: 3 }),
    ]);
    expect(rowOf(today, "epic")).toMatchObject({ estimate: 3, noEstimate: false });
  });

  it("uses the area's unit", () => {
    const today = build(
      [
        ...history("work", 6),
        cold("criteria", {
          criteria: [
            { id: "1", text: "1", tickedAt: null, tickedBy: null, evidence: null },
            { id: "2", text: "2", tickedAt: null, tickedBy: null, evidence: null },
          ],
        }),
      ],
      { areaSettings: areaSettings({ work: { unit: "criteria" } }) },
    );
    expect(rowOf(today, "criteria")).toMatchObject({ estimate: 2, noEstimate: false });
    expect(today.capacity.work).toMatchObject({ unit: "criteria", perDay: null });
  });
});
