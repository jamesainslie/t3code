import {
  DEFAULT_ROADMAP_AREA_SETTINGS,
  type IsoDate,
  RoadmapItemId,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapUnit,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  addWorkingDays,
  daysBetween,
  averageLeafSize,
  burndown,
  burned,
  compareRank,
  forecast,
  isSnoozed,
  isWorkingDay,
  lastActivityAt,
  leavesUnder,
  localDateOf,
  remaining,
  rolledUpEstimate,
  type RoadmapVelocity,
  totalUnits,
  velocity,
  workingDaysBetween,
} from "./roadmapCalc.ts";

const id = RoadmapItemId.make;
const MON_FRI = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
// A Tuesday, so the trailing 15 working days run from Wednesday 30 September.
const TODAY = "2026-10-20";
const user = { _tag: "user" } as const;
const at = (date: IsoDate, time = "12:00:00.000") => `${date}T${time}Z`;

const item = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: id(itemId),
  type: "story",
  title: `Item ${itemId}`,
  description: "",
  parentId: null,
  sortKey: "n",
  state: "backlog",
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
  updatedAt: at("2026-09-01"),
  createdBy: user,
  stateChangedAt: at("2026-09-01"),
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

const done = (itemId: string, date: IsoDate, overrides: Partial<RoadmapWorkItem> = {}) =>
  item(itemId, { state: "done", completedAt: at(date), stateChangedAt: at(date), ...overrides });

const child = (itemId: string, parent: string, overrides: Partial<RoadmapWorkItem> = {}) =>
  item(itemId, { parentId: id(parent), area: null, ...overrides });

const byIdOf = (...items: ReadonlyArray<RoadmapWorkItem>) =>
  new Map(items.map((entry) => [entry.id, entry]));

const tick = (criterionId: string, date: IsoDate | null) => ({
  id: criterionId,
  text: criterionId,
  tickedAt: date === null ? null : at(date),
  tickedBy: date === null ? null : user,
  evidence: null,
});

const hoursEntry = (entryId: string, date: IsoDate, hours: number) => ({
  id: entryId,
  at: at(date),
  hours,
  actor: user,
  note: null,
});

const settings = (unit: RoadmapUnit = "points", workingWeekdays = MON_FRI) => ({
  ...DEFAULT_ROADMAP_AREA_SETTINGS,
  unit,
  workingWeekdays,
});

const perDay = (value: number): RoadmapVelocity => ({
  perDay: value,
  sampleSize: 10,
  units: value * 15,
  workingDays: 15,
  source: "window",
});

describe("working days", () => {
  it("knows weekends from working days, for any working week", () => {
    expect(isWorkingDay("2026-10-17", MON_FRI)).toBe(false);
    expect(isWorkingDay("2026-10-19", MON_FRI)).toBe(true);
    expect(isWorkingDay("2026-10-17", WEEKENDS)).toBe(true);
    expect(isWorkingDay("2026-10-19", WEEKENDS)).toBe(false);
  });

  it("counts working days after the first date up to and including the second", () => {
    expect(workingDaysBetween("2026-10-16", "2026-10-19", MON_FRI)).toBe(1);
    expect(workingDaysBetween("2026-10-19", "2026-10-16", MON_FRI)).toBe(-1);
    expect(workingDaysBetween("2026-10-20", "2026-10-20", MON_FRI)).toBe(0);
    expect(workingDaysBetween("2026-10-12", "2026-10-26", MON_FRI)).toBe(10);
    expect(workingDaysBetween("2026-10-16", "2026-10-19", WEEKENDS)).toBe(2);
    expect(Object.is(workingDaysBetween("2026-10-18", "2026-10-17", MON_FRI), -0)).toBe(false);
  });

  it("matches a day-by-day count over long spans", () => {
    const naive = (from: IsoDate, to: IsoDate, weekdays: ReadonlyArray<number>) => {
      let count = 0;
      for (let day = Date.parse(from) + 86_400_000; day <= Date.parse(to); day += 86_400_000) {
        if (weekdays.includes(DateTime.getPartUtc(DateTime.makeUnsafe(day), "weekDay"))) {
          count += 1;
        }
      }
      return count;
    };
    for (const [from, to] of [
      ["2026-01-01", "2026-12-31"],
      ["2025-12-29", "2026-03-04"],
      ["2026-10-17", "2027-02-01"],
    ] as const) {
      expect(workingDaysBetween(from, to, MON_FRI)).toBe(naive(from, to, MON_FRI));
      expect(workingDaysBetween(from, to, [3])).toBe(naive(from, to, [3]));
      expect(workingDaysBetween(to, from, MON_FRI)).toBe(-naive(from, to, MON_FRI));
    }
  });

  it("counts calendar days between dates, either way and across months", () => {
    expect(daysBetween("2026-10-19", "2026-11-15")).toBe(27);
    expect(daysBetween("2026-10-19", "2026-10-01")).toBe(-18);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("adds working days, skipping weekends", () => {
    expect(addWorkingDays("2026-10-16", 1, MON_FRI)).toBe("2026-10-19");
    expect(addWorkingDays("2026-10-17", 1, MON_FRI)).toBe("2026-10-19");
    expect(addWorkingDays("2026-10-19", -1, MON_FRI)).toBe("2026-10-16");
    expect(addWorkingDays("2026-10-18", -1, MON_FRI)).toBe("2026-10-16");
    expect(addWorkingDays("2026-10-20", 5, MON_FRI)).toBe("2026-10-27");
    expect(addWorkingDays("2026-10-18", 0, MON_FRI)).toBe("2026-10-18");
    expect(addWorkingDays("2026-10-20", 2, WEEKENDS)).toBe("2026-10-25");
  });

  it("undoes workingDaysBetween forward from any date, and back from a working day", () => {
    for (const weekdays of [MON_FRI, WEEKENDS]) {
      for (const from of ["2026-10-17", "2026-10-18", "2026-10-20", "2026-12-31"]) {
        for (let count = 0; count <= 20; count += 1) {
          const ahead = addWorkingDays(from, count, weekdays);
          expect(workingDaysBetween(from, ahead, weekdays)).toBe(count);
          if (!isWorkingDay(from, weekdays)) continue;
          const back = addWorkingDays(from, -count, weekdays);
          expect(workingDaysBetween(from, back, weekdays)).toBe(0 - count);
        }
      }
    }
  });

  it("reads a timestamp as a local calendar date", () => {
    const localWallClock = (parts: { readonly day: number; readonly hour: number }) =>
      DateTime.formatIso(
        DateTime.makeZonedUnsafe(
          { year: 2026, month: 10, minute: 30, ...parts },
          { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
        ),
      );
    expect(localDateOf(localWallClock({ day: 18, hour: 23 }))).toBe("2026-10-18");
    expect(localDateOf(localWallClock({ day: 19, hour: 0 }))).toBe("2026-10-19");
  });
});

describe("tree roll-up", () => {
  const epic = item("epic", { type: "epic" });
  const feature = child("feature", "epic", { type: "feature", sortKey: "a" });
  const storyA = child("a", "feature", { estimate: 2 });
  const storyB = child("b", "feature", { estimate: 3 });
  const bug = child("bug", "epic", { type: "bug", estimate: 1, sortKey: "b" });

  it("finds the leaves under an item, or the item itself when it has none", () => {
    const byId = byIdOf(epic, feature, storyA, storyB, bug);
    expect(leavesUnder(epic, byId).map((leaf) => leaf.id)).toEqual(["a", "b", "bug"]);
    expect(leavesUnder(storyA, byId).map((leaf) => leaf.id)).toEqual(["a"]);
  });

  it("sums the children's estimates when no estimate is set directly", () => {
    const byId = byIdOf(epic, feature, storyA, storyB, bug);
    expect(rolledUpEstimate(epic, byId)).toEqual({
      value: 6,
      direct: null,
      fromChildren: 6,
      differs: false,
    });
    expect(rolledUpEstimate(storyA, byId)).toEqual({
      value: 2,
      direct: 2,
      fromChildren: null,
      differs: false,
    });
  });

  it("lets a direct estimate win and reports both when they differ", () => {
    const sized = { ...feature, estimate: 8 };
    const byId = byIdOf(epic, sized, storyA, storyB, bug);
    expect(rolledUpEstimate(sized, byId)).toEqual({
      value: 8,
      direct: 8,
      fromChildren: 5,
      differs: true,
    });
    expect(rolledUpEstimate(epic, byId).value).toBe(9);
  });

  it("has no estimate when nothing under it has one", () => {
    const bare = item("bare", { type: "epic" });
    expect(rolledUpEstimate(bare, byIdOf(bare)).value).toBeNull();
  });

  it("survives a corrupt parent loop", () => {
    const loopA = item("x", { parentId: id("y"), estimate: 1 });
    const loopB = item("y", { parentId: id("x"), estimate: 1 });
    const byId = byIdOf(loopA, loopB);
    expect(rolledUpEstimate(loopA, byId).value).toBe(1);
    expect(leavesUnder(loopA, byId).length).toBeLessThanOrEqual(2);
  });
});

describe("burned and remaining", () => {
  const epic = item("epic", { type: "epic" });
  const doneStory = child("a", "epic", {
    state: "done",
    completedAt: at("2026-10-14"),
    estimate: 2,
    criteria: [tick("a1", "2026-10-13"), tick("a2", "2026-10-14")],
    hours: [hoursEntry("h1", "2026-10-13", 2)],
  });
  const openStory = child("b", "epic", {
    state: "in-progress",
    estimate: 3,
    criteria: [tick("b1", "2026-10-15"), tick("b2", null), tick("b3", null)],
    hours: [hoursEntry("h2", "2026-10-15", 1.5)],
  });
  const byId = byIdOf(epic, doneStory, openStory);

  it("counts done leaves in items", () => {
    expect(totalUnits(epic, byId, "items")).toBe(2);
    expect(burned(epic, byId, "items")).toBe(1);
    expect(remaining(epic, byId, "items")).toBe(1);
  });

  it("sums done leaves' estimates in points", () => {
    expect(totalUnits(epic, byId, "points")).toBe(5);
    expect(burned(epic, byId, "points")).toBe(2);
    expect(remaining(epic, byId, "points")).toBe(3);
  });

  it("counts ticked criteria across the subtree", () => {
    expect(totalUnits(epic, byId, "criteria")).toBe(5);
    expect(burned(epic, byId, "criteria")).toBe(3);
    expect(remaining(epic, byId, "criteria")).toBe(2);
  });

  it("sums logged hours across the subtree against the hour estimate", () => {
    expect(totalUnits(epic, byId, "hours")).toBe(5);
    expect(burned(epic, byId, "hours")).toBe(3.5);
    expect(remaining(epic, byId, "hours")).toBe(1.5);
  });

  it("burns against a direct estimate on the parent", () => {
    const sized = { ...epic, estimate: 10 };
    const sizedById = byIdOf(sized, doneStory, openStory);
    expect(remaining(sized, sizedById, "points")).toBe(8);
  });

  it("has nothing left on a done item, and never goes below zero", () => {
    expect(remaining(doneStory, byId, "hours")).toBe(0);
    const overrun = item("over", { estimate: 1, hours: [hoursEntry("h", "2026-10-15", 3)] });
    expect(remaining(overrun, byIdOf(overrun), "hours")).toBe(0);
  });

  it("does not burn a reopened item", () => {
    const reopened = { ...doneStory, state: "in-progress" as const, completedAt: null };
    const reopenedById = byIdOf(epic, reopened, openStory);
    expect(burned(epic, reopenedById, "points")).toBe(0);
    expect(burned(epic, reopenedById, "items")).toBe(0);
  });

  it("has no total without an estimate or criteria", () => {
    const bare = item("bare");
    expect(totalUnits(bare, byIdOf(bare), "points")).toBeNull();
    expect(totalUnits(bare, byIdOf(bare), "criteria")).toBeNull();
    expect(remaining(bare, byIdOf(bare), "points")).toBeNull();
    expect(totalUnits(bare, byIdOf(bare), "items")).toBe(1);
  });
});

describe("velocity", () => {
  const fiveDone = [
    done("v1", "2026-10-01", { estimate: 1 }),
    done("v2", "2026-10-06", { estimate: 2 }),
    done("v3", "2026-10-13", { estimate: 3 }),
    done("v4", "2026-10-16", { estimate: 2 }),
    done("v5", "2026-10-20", { estimate: 2 }),
  ];
  const run = (
    items: ReadonlyArray<RoadmapWorkItem>,
    unit: RoadmapUnit = "points",
    extra: Partial<Parameters<typeof velocity>[0]> = {},
  ) => velocity({ items, area: "work", settings: settings(unit), today: TODAY, ...extra });

  it("is the units done per working day over the trailing 15 working days", () => {
    expect(run(fiveDone)).toEqual({
      perDay: 10 / 15,
      sampleSize: 5,
      units: 10,
      workingDays: 15,
      source: "window",
    });
  });

  it("includes the window's first day and excludes the day before it", () => {
    const edge = [
      done("in", "2026-09-30", { estimate: 4 }),
      done("out", "2026-09-29", { estimate: 100 }),
    ];
    expect(run([...fiveDone, ...edge])?.units).toBe(14);
  });

  it("still spans 15 working days when today is a weekend", () => {
    // From Sunday the 18th, the fifteenth working day back is Monday 28 September.
    const sunday = [
      ...fiveDone.slice(0, 4),
      done("first", "2026-09-28", { estimate: 5 }),
      done("before", "2026-09-25", { estimate: 100 }),
    ];
    expect(run(sunday, "points", { today: "2026-10-18" })?.units).toBe(13);
  });

  it("is null under five samples", () => {
    expect(run(fiveDone.slice(0, 4))).toBeNull();
  });

  it("counts leaves only, so an epic and its stories never count twice", () => {
    const epic = done("epic", "2026-10-19", { type: "epic", estimate: 20 });
    const stories = fiveDone.map((entry) => ({ ...entry, parentId: id("epic"), area: null }));
    expect(run([epic, ...stories])?.units).toBe(10);
  });

  it("ignores reopened items and other areas, following inherited areas", () => {
    const reopened = item("re", { state: "in-progress", estimate: 5, completedAt: null });
    const personalRoot = item("home", { type: "epic", area: "personal" });
    const personalLeaf = done("p", "2026-10-15", {
      parentId: id("home"),
      area: null,
      estimate: 7,
    });
    expect(run([...fiveDone, reopened, personalRoot, personalLeaf])?.units).toBe(10);
    expect(
      velocity({
        items: [...fiveDone, personalRoot, personalLeaf],
        area: "personal",
        settings: settings(),
        today: TODAY,
      }),
    ).toBeNull();
  });

  it("counts each leaf once in items", () => {
    expect(run(fiveDone, "items")?.units).toBe(5);
  });

  it("counts ticks in criteria and logged hours in hours", () => {
    const ticked = item("c", {
      criteria: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].map(
        (date, index) => tick(`c${index}`, date),
      ),
    });
    expect(run([ticked], "criteria")).toMatchObject({ units: 5, sampleSize: 5 });
    const logged = item("h", {
      hours: ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-09-01"].map(
        (date, index) => hoursEntry(`h${index}`, date, 1.5),
      ),
    });
    expect(run([logged], "hours")).toBeNull();
    const more = { ...logged, hours: [...logged.hours, hoursEntry("h9", "2026-10-19", 2)] };
    expect(run([more], "hours")).toMatchObject({ units: 8, sampleSize: 5 });
  });

  it("reads completion dates through the caller's calendar", () => {
    // 02:00 UTC on the 30th is still the 29th seven hours west of UTC.
    const lateNight = done("late", "2026-09-30", { completedAt: "2026-09-30T02:00:00.000Z" });
    const westCoast = (value: string) =>
      DateTime.formatIsoDateUtc(DateTime.subtract(DateTime.makeUnsafe(value), { hours: 7 }));
    expect(run([...fiveDone, lateNight], "items")?.units).toBe(6);
    expect(run([...fiveDone, lateNight], "items", { dateOf: westCoast })?.units).toBe(5);
  });

  it("uses a working week of the area's own days", () => {
    // Weekends only: the 15 working days reach back to 29 August.
    const weekendDone = ["2026-09-05", "2026-09-12", "2026-09-19", "2026-10-03", "2026-10-18"].map(
      (date, index) => done(`w${index}`, date, { estimate: 3 }),
    );
    const result = velocity({
      items: weekendDone,
      area: "work",
      settings: settings("points", WEEKENDS),
      today: TODAY,
    });
    expect(result).toMatchObject({ units: 15, perDay: 1 });
  });

  describe("from sprints", () => {
    const sprint = (sprintId: string, startDate: IsoDate, endDate: IsoDate): RoadmapSprint => ({
      id: RoadmapSprintId.make(sprintId),
      name: sprintId,
      area: "work",
      startDate,
      endDate,
    });
    const sprints = [
      sprint("s1", "2026-09-21", "2026-09-25"),
      sprint("s2", "2026-09-28", "2026-10-02"),
      sprint("s3", "2026-10-05", "2026-10-09"),
      sprint("s4", "2026-10-12", "2026-10-16"),
      sprint("now", "2026-10-19", "2026-10-23"),
    ];
    const inSprint = (itemId: string, sprintId: string, date: IsoDate, estimate: number) =>
      done(itemId, date, { sprintId: RoadmapSprintId.make(sprintId), estimate });
    const items = [
      inSprint("x1", "s1", "2026-09-22", 50),
      inSprint("x2", "s2", "2026-09-29", 3),
      inSprint("x3", "s2", "2026-10-01", 2),
      inSprint("x4", "s3", "2026-10-07", 4),
      inSprint("x5", "s4", "2026-10-13", 3),
      inSprint("x6", "s4", "2026-10-16", 3),
    ];

    it("uses the last three finished sprints of the area when asked", () => {
      expect(run(items, "points", { sprints, useSprints: true })).toEqual({
        perDay: 15 / 15,
        sampleSize: 5,
        units: 15,
        workingDays: 15,
        source: "sprints",
      });
    });

    it("falls back to the trailing window with fewer than three finished sprints", () => {
      const result = run([...items, ...fiveDone], "points", {
        sprints: sprints.slice(2),
        useSprints: true,
      });
      expect(result?.source).toBe("window");
    });

    it("ignores another area's sprints", () => {
      const personal = sprints.map((entry) => ({ ...entry, area: "personal" as const }));
      const result = run([...items, ...fiveDone], "points", {
        sprints: personal,
        useSprints: true,
      });
      expect(result?.source).toBe("window");
    });
  });
});

describe("average leaf size", () => {
  it("averages the done leaves in the window, skipping ones with no size", () => {
    const items = [
      done("a", "2026-10-01", { estimate: 1 }),
      done("b", "2026-10-06", { estimate: 5 }),
      done("c", "2026-10-07"),
      done("old", "2026-09-01", { estimate: 40 }),
    ];
    expect(averageLeafSize({ items, area: "work", settings: settings(), today: TODAY })).toBe(3);
    expect(
      averageLeafSize({ items, area: "work", settings: settings("items"), today: TODAY }),
    ).toBe(1);
    expect(averageLeafSize({ items: [], area: "work", settings: settings(), today: TODAY })).toBe(
      null,
    );
  });
});

describe("forecast", () => {
  const run = (
    remainingPoints: number,
    dueDate: IsoDate | null,
    overrides: { velocity?: RoadmapVelocity | null; weekdays?: ReadonlyArray<number> } = {},
  ) => {
    const target = item("f", { estimate: remainingPoints, dueDate });
    return forecast({
      item: target,
      byId: byIdOf(target),
      unit: "points",
      velocity: overrides.velocity === undefined ? perDay(1) : overrides.velocity,
      today: TODAY,
      weekdays: overrides.weekdays ?? MON_FRI,
    });
  };

  it("is on track with slack to spare", () => {
    expect(run(2, "2026-10-30")).toEqual({
      status: "on-track",
      projected: "2026-10-22",
      slackDays: 6,
    });
  });

  it("is at risk when it lands on the due date with no slack", () => {
    expect(run(3, "2026-10-23")).toEqual({
      status: "at-risk",
      projected: "2026-10-23",
      slackDays: 0,
    });
  });

  it("is at risk only when slack is under 20 percent of the working days left", () => {
    // Ten working days left: two days of slack is exactly 20 percent.
    expect(run(8, "2026-11-03")).toMatchObject({ status: "on-track", slackDays: 2 });
    expect(run(9, "2026-11-03")).toMatchObject({ status: "at-risk", slackDays: 1 });
  });

  it("is late when projected after the due date, and when already overdue", () => {
    expect(run(4, "2026-10-23")).toEqual({
      status: "late",
      projected: "2026-10-26",
      slackDays: -1,
    });
    expect(run(1, "2026-10-16").status).toBe("late");
  });

  it("rounds part of a day up to a whole working day", () => {
    expect(run(2.5, null).projected).toBe("2026-10-23");
  });

  it("projects today when nothing remains", () => {
    expect(run(0, "2026-10-23")).toMatchObject({ status: "on-track", projected: TODAY });
  });

  it("is on track with no slack figure when there is no due date", () => {
    expect(run(2, null)).toEqual({ status: "on-track", projected: "2026-10-22", slackDays: null });
  });

  it("uses the area's working week", () => {
    expect(run(2, "2026-10-25", { weekdays: WEEKENDS })).toEqual({
      status: "at-risk",
      projected: "2026-10-25",
      slackDays: 0,
    });
  });

  it("has no forecast without velocity, without an estimate, or once done", () => {
    expect(run(2, "2026-10-30", { velocity: null }).status).toBe("no-forecast");
    const bare = item("bare", { dueDate: "2026-10-30" });
    expect(
      forecast({
        item: bare,
        byId: byIdOf(bare),
        unit: "points",
        velocity: perDay(1),
        today: TODAY,
        weekdays: MON_FRI,
      }),
    ).toEqual({ status: "no-forecast", projected: null, slackDays: null });
    const finished = done("fin", "2026-10-19", { estimate: 3, dueDate: "2026-10-30" });
    expect(
      forecast({
        item: finished,
        byId: byIdOf(finished),
        unit: "points",
        velocity: perDay(1),
        today: TODAY,
        weekdays: MON_FRI,
      }).status,
    ).toBe("no-forecast");
  });
});

describe("burndown", () => {
  const epic = item("epic", {
    type: "epic",
    startDate: "2026-10-12",
    dueDate: "2026-10-23",
  });
  const leaves = [
    child("a", "epic", { estimate: 2, state: "done", completedAt: at("2026-10-14") }),
    child("b", "epic", { estimate: 3, state: "done", completedAt: at("2026-10-19") }),
    child("c", "epic", { estimate: 5 }),
  ];

  it("walks remaining units per working day to today, beside the ideal line", () => {
    const result = burndown({
      scope: { kind: "item", item: epic },
      items: [epic, ...leaves],
      unit: "points",
      today: TODAY,
      weekdays: MON_FRI,
    });
    expect(result?.total).toBe(10);
    expect(result?.points.map((point) => [point.date, point.remaining])).toEqual([
      ["2026-10-12", 10],
      ["2026-10-13", 10],
      ["2026-10-14", 8],
      ["2026-10-15", 8],
      ["2026-10-16", 8],
      ["2026-10-19", 5],
      ["2026-10-20", 5],
      ["2026-10-21", null],
      ["2026-10-22", null],
      ["2026-10-23", null],
    ]);
    expect(result?.points.map((point) => point.ideal)).toEqual(
      Array.from({ length: 10 }, (_, index) => 10 * (1 - index / 9)),
    );
  });

  it("burns a sprint's items between its dates", () => {
    const sprintId = RoadmapSprintId.make("s");
    const sprint: RoadmapSprint = {
      id: sprintId,
      name: "S",
      area: "work",
      startDate: "2026-10-19",
      endDate: "2026-10-23",
    };
    const items = [
      item("x", { sprintId, estimate: 4, state: "done", completedAt: at("2026-10-20") }),
      item("y", { sprintId, estimate: 2 }),
      item("outside", { estimate: 9, state: "done", completedAt: at("2026-10-20") }),
    ];
    const result = burndown({
      scope: { kind: "sprint", sprint },
      items,
      unit: "points",
      today: TODAY,
      weekdays: MON_FRI,
    });
    expect(result?.total).toBe(6);
    expect(result?.points.map((point) => point.remaining)).toEqual([6, 2, null, null, null]);
  });

  it("has no burndown without a due date or an estimate", () => {
    const undated = { ...epic, dueDate: null };
    expect(
      burndown({
        scope: { kind: "item", item: undated },
        items: [undated, ...leaves],
        unit: "points",
        today: TODAY,
        weekdays: MON_FRI,
      }),
    ).toBeNull();
    const bare = item("bare", { dueDate: "2026-10-23" });
    expect(
      burndown({
        scope: { kind: "item", item: bare },
        items: [bare],
        unit: "points",
        today: TODAY,
        weekdays: MON_FRI,
      }),
    ).toBeNull();
  });
});

describe("compareRank", () => {
  const topObjective = item("top", { type: "objective", priority: "p0", sortKey: "a" });
  const lowObjective = item("low", { type: "objective", priority: "p2", sortKey: "b" });
  const otherTop = item("other", { type: "objective", priority: "p0", sortKey: "c" });

  it("ranks a P0 epic under a lower objective above a P2 epic under the top one", () => {
    const urgent = child("urgent", "low", { type: "epic", priority: "p0" });
    const relaxed = child("relaxed", "top", { type: "epic", priority: "p2" });
    const byId = byIdOf(topObjective, lowObjective, urgent, relaxed);
    expect(compareRank(urgent, relaxed, byId)).toBeLessThan(0);
    expect(compareRank(relaxed, urgent, byId)).toBeGreaterThan(0);
  });

  it("breaks a priority tie by the parents' rank, then sibling order", () => {
    const underTop = child("t1", "top", { type: "epic", sortKey: "z" });
    const underOther = child("o1", "other", { type: "epic", sortKey: "a" });
    const sibling = child("t2", "top", { type: "epic", sortKey: "m" });
    const byId = byIdOf(topObjective, otherTop, underTop, underOther, sibling);
    expect(compareRank(underTop, underOther, byId)).toBeLessThan(0);
    expect(compareRank(sibling, underTop, byId)).toBeLessThan(0);
    expect(compareRank(underTop, underTop, byId)).toBe(0);
  });

  it("keeps a child with its parent when the other item is a root", () => {
    const parent = item("parent", { type: "epic", priority: "p0", sortKey: "a" });
    const kid = child("kid", "parent", { priority: "p0", sortKey: "z" });
    const root = item("root", { priority: "p0", sortKey: "m" });
    const byId = byIdOf(parent, kid, root);
    expect(
      [root, kid, parent].sort((a, b) => compareRank(a, b, byId)).map((entry) => entry.id),
    ).toEqual(["parent", "kid", "root"]);
  });

  it("orders a list with inherited priorities", () => {
    const items = [
      child("inherits-p2", "low", { type: "epic", sortKey: "a" }),
      item("root-p1", { type: "objective", priority: "p1", sortKey: "d" }),
      child("inherits-p0", "top", { type: "epic", sortKey: "a" }),
      topObjective,
      lowObjective,
    ];
    const byId = byIdOf(...items);
    expect([...items].sort((a, b) => compareRank(a, b, byId)).map((entry) => entry.id)).toEqual([
      "top",
      "inherits-p0",
      "root-p1",
      "low",
      "inherits-p2",
    ]);
  });
});

describe("activity and snooze", () => {
  it("takes the latest of state changes, ticks, hours and attached threads", () => {
    const target = item("a", {
      stateChangedAt: at("2026-10-01"),
      criteria: [tick("c", "2026-10-05"), tick("d", null)],
      hours: [hoursEntry("h", "2026-10-07", 1)],
    });
    expect(lastActivityAt(target, new Map())).toBe(at("2026-10-07"));
    expect(
      lastActivityAt(target, new Map([[target.id, { latestActivityAt: at("2026-10-09") }]])),
    ).toBe(at("2026-10-09"));
    expect(
      lastActivityAt(target, new Map([[target.id, { latestActivityAt: at("2026-09-01") }]])),
    ).toBe(at("2026-10-07"));
    expect(lastActivityAt(target, new Map([[target.id, { latestActivityAt: null }]]))).toBe(
      at("2026-10-07"),
    );
  });

  it("is snoozed only while the snooze date is after today", () => {
    expect(isSnoozed(item("a", { snoozedUntil: "2026-10-21" }), TODAY)).toBe(true);
    expect(isSnoozed(item("a", { snoozedUntil: TODAY }), TODAY)).toBe(false);
    expect(isSnoozed(item("a"), TODAY)).toBe(false);
  });
});
