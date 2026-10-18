import {
  EnvironmentId,
  RoadmapItemId,
  ThreadId,
  type RoadmapItemType,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  blocksOf,
  cardForecastText,
  formatUnitProgress,
  formatVelocity,
  parentPath,
  roadmapActorLabel,
  roadmapCardOpen,
  roadmapCardSlots,
  roadmapCardView,
} from "./roadmapCard.logic";

const thread = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

const item = (
  id: string,
  overrides: Partial<RoadmapWorkItem> & { readonly type?: RoadmapItemType } = {},
): RoadmapWorkItem => ({
  id: RoadmapItemId.make(id),
  type: "feature",
  title: `Title ${id}`,
  description: "",
  parentId: null,
  sortKey: id,
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
  createdAt: "2026-10-18T00:00:00.000Z",
  updatedAt: "2026-10-18T00:00:00.000Z",
  createdBy: { _tag: "user" },
  stateChangedAt: "2026-10-18T00:00:00.000Z",
  completedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  ...overrides,
});

describe("parentPath", () => {
  it("lists the ancestors from the root down", () => {
    const items = [
      item("root", { type: "objective" }),
      item("mid", { type: "epic", parentId: RoadmapItemId.make("root") }),
      item("leaf", { parentId: RoadmapItemId.make("mid") }),
    ];
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    expect(parentPath(items[2]!, byId).map((entry) => entry.id)).toEqual(["root", "mid"]);
    expect(parentPath(items[0]!, byId)).toEqual([]);
  });

  it("stops at a missing parent and at a corrupt loop", () => {
    const loopA = item("a", { parentId: RoadmapItemId.make("b") });
    const loopB = item("b", { parentId: RoadmapItemId.make("a") });
    const orphan = item("orphan", { parentId: RoadmapItemId.make("gone") });
    const byId = new Map([loopA, loopB, orphan].map((entry) => [entry.id, entry]));
    expect(parentPath(orphan, byId)).toEqual([]);
    expect(parentPath(loopA, byId).map((entry) => entry.id)).toEqual(["b"]);
  });
});

describe("blocksOf", () => {
  it("lists the items this one blocks", () => {
    const blocker = item("blocker");
    const items = [blocker, item("waits", { blockedBy: [blocker.id] }), item("free")];
    expect(blocksOf(blocker, items).map((entry) => entry.id)).toEqual(["waits"]);
  });
});

describe("roadmapActorLabel", () => {
  it("names each kind of actor", () => {
    expect(roadmapActorLabel({ _tag: "user" })).toBe("You");
    expect(roadmapActorLabel({ _tag: "agent", thread, threadTitle: "Fix login" })).toBe(
      "Fix login",
    );
    expect(roadmapActorLabel({ _tag: "steward", environmentId: thread.environmentId })).toBe(
      "Steward",
    );
    expect(roadmapActorLabel({ _tag: "github" })).toBe("GitHub");
  });
});

describe("roadmapCardOpen", () => {
  it("follows attachment until the user opens or closes it", () => {
    expect(roadmapCardOpen(null, true)).toBe(true);
    expect(roadmapCardOpen(null, false)).toBe(false);
    expect(roadmapCardOpen(false, true)).toBe(false);
    expect(roadmapCardOpen(true, false)).toBe(true);
  });
});

describe("roadmapCardSlots", () => {
  // 2026-10-19 is a Monday. Five done 3 point leaves in the window make 1 point a day.
  const today = "2026-10-19";
  const weekdays = [1, 2, 3, 4, 5];
  const areaSettings = {
    work: { unit: "points" as const, workingWeekdays: weekdays, goingColdDays: 5 },
    personal: { unit: "hours" as const, workingWeekdays: [0, 1, 2, 3, 4], goingColdDays: 5 },
  };
  const history = ["a", "b", "c", "d", "e"].map((name) =>
    item(`done-${name}`, {
      type: "story",
      area: "work",
      state: "done",
      estimate: 3,
      completedAt: "2026-10-14T12:00:00.000Z",
    }),
  );
  const hoursEntry = (entryId: string, hours: number) => ({
    id: entryId,
    at: "2026-10-16T12:00:00.000Z",
    hours,
    actor: { _tag: "user" } as const,
    note: null,
  });

  it("fills every slot the item has data for", () => {
    const epic = item("epic", { type: "epic", area: "work", dueDate: "2026-10-23" });
    const children = [
      item("s1", { type: "story", parentId: epic.id, estimate: 2, state: "done" }),
      item("s2", { type: "story", parentId: epic.id, estimate: 2 }),
    ];
    const target = { ...epic, hours: [hoursEntry("h1", 1.5), hoursEntry("h2", 2)] };
    const items = [...history, target, ...children];
    expect(roadmapCardSlots({ item: target, items, sprints: [], areaSettings, today })).toEqual({
      unit: "points",
      daysLeft: 4,
      forecast: { status: "on-track", projected: "2026-10-21", slackDays: 2 },
      progress: { burned: 2, total: 4 },
      velocity: 1,
      hoursLogged: 3.5,
    });
  });

  it("leaves out what the item has no data for", () => {
    const bare = item("bare", { type: "story", area: "work" });
    expect(
      roadmapCardSlots({ item: bare, items: [bare], sprints: [], areaSettings, today }),
    ).toEqual({
      unit: "points",
      daysLeft: null,
      forecast: null,
      progress: null,
      velocity: null,
      hoursLogged: null,
    });
  });

  it("counts working days on the item's own area calendar", () => {
    const personal = item("p", { area: "personal", dueDate: "2026-10-25" });
    // Sunday to Thursday: from Monday to Sunday Oct 25 is Tue, Wed, Thu and Sun.
    expect(
      roadmapCardSlots({ item: personal, items: [personal], sprints: [], areaSettings, today })
        .daysLeft,
    ).toBe(4);
  });
});

describe("card formatting", () => {
  it("writes amounts in the area's unit", () => {
    expect(formatUnitProgress({ burned: 6, total: 10 }, "points")).toBe("6 of 10 pts");
    expect(formatUnitProgress({ burned: 1, total: 1 }, "items")).toBe("1 of 1 item");
    expect(formatUnitProgress({ burned: 2.25, total: 8 }, "hours")).toBe("2.3 of 8 hrs");
    expect(formatUnitProgress({ burned: 0, total: 3 }, "criteria")).toBe("0 of 3 criteria");
  });

  it("writes velocity per working day", () => {
    expect(formatVelocity(1.4, "points")).toBe("1.4 pts / day");
    expect(formatVelocity(1, "items")).toBe("1 item / day");
    expect(formatVelocity(0.333, "criteria")).toBe("0.3 criteria / day");
  });

  it("names the forecast with its projected weekday and date", () => {
    expect(
      cardForecastText({ status: "at-risk", projected: "2026-10-23", slackDays: 0 }, "2026-10-19"),
    ).toBe("At risk, Fri Oct 23");
    expect(
      cardForecastText({ status: "on-track", projected: "2027-01-04", slackDays: 4 }, "2026-10-19"),
    ).toBe("On track, Mon Jan 4, 2027");
  });
});

describe("roadmapCardView", () => {
  const base = {
    supported: true,
    homeConnected: true,
    threadOnHome: true,
    items: [] as ReadonlyArray<RoadmapWorkItem> | null,
    thread,
  };

  it("hides without a roadmap on the home", () => {
    expect(roadmapCardView({ ...base, supported: false }).kind).toBe("hidden");
  });

  it("reports the home offline only for a thread on another environment", () => {
    expect(
      roadmapCardView({ ...base, threadOnHome: false, homeConnected: false, items: null }).kind,
    ).toBe("offline");
    expect(roadmapCardView({ ...base, homeConnected: false, items: null }).kind).toBe("loading");
  });

  it("waits for the roadmap, then shows the attached item or the empty state", () => {
    expect(roadmapCardView({ ...base, items: null }).kind).toBe("loading");
    expect(roadmapCardView(base).kind).toBe("empty");
    const attached = item("on", {
      attachments: [{ thread, attachedAt: "2026-10-18T00:00:00.000Z" }],
    });
    expect(roadmapCardView({ ...base, items: [item("other"), attached] })).toEqual({
      kind: "attached",
      item: attached,
    });
  });
});
