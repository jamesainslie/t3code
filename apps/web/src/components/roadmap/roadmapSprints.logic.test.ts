import {
  CommandId,
  RoadmapItemId,
  RoadmapSprintId,
  type RoadmapSprint,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSprintCommand,
  emptySprintDraft,
  formatSprintDates,
  sprintDeleteMessage,
  sprintDraftFor,
  sprintItemCount,
  sprintOptionsFor,
  withSprintDraftArea,
} from "./roadmapSprints.logic";

const sprintId = RoadmapSprintId.make;
const commandId = CommandId.make("cmd-1");

const sprint = (id: string, overrides: Partial<RoadmapSprint> = {}): RoadmapSprint => ({
  id: sprintId(id),
  name: `Sprint ${id}`,
  area: "work",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  ...overrides,
});

const item = (id: string, sprint: string | null): RoadmapWorkItem => ({
  id: RoadmapItemId.make(id),
  type: "story",
  title: id,
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
  sprintId: sprint === null ? null : sprintId(sprint),
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
});

describe("sprintOptionsFor", () => {
  const sprints = [sprint("w1"), sprint("p1", { area: "personal" }), sprint("w2")];

  it("offers the area's sprints in order", () => {
    expect(sprintOptionsFor(sprints, "work", null).map((entry) => entry.id)).toEqual(["w1", "w2"]);
  });

  it("keeps the item's current sprint even from another area, so the select can show it", () => {
    expect(sprintOptionsFor(sprints, "work", sprintId("p1")).map((entry) => entry.id)).toEqual([
      "w1",
      "p1",
      "w2",
    ]);
  });

  it("offers every sprint when the area is not known yet", () => {
    expect(sprintOptionsFor(sprints, null, null)).toHaveLength(3);
  });
});

describe("sprintItemCount", () => {
  it("counts the items a delete would clear", () => {
    const items = [item("a", "s1"), item("b", "s1"), item("c", "s2"), item("d", null)];
    expect(sprintItemCount(sprintId("s1"), items)).toBe(2);
    expect(sprintItemCount(sprintId("s3"), items)).toBe(0);
  });

  it("warns how many items a delete clears", () => {
    expect(sprintDeleteMessage(sprint("s1"), 2)).toBe(
      "Delete Sprint s1?\nIts 2 items stay on the roadmap with no sprint.",
    );
    expect(sprintDeleteMessage(sprint("s1"), 1)).toBe(
      "Delete Sprint s1?\nIts 1 item stays on the roadmap with no sprint.",
    );
    expect(sprintDeleteMessage(sprint("s1"), 0)).toBe("Delete Sprint s1?\nNo items are in it.");
  });
});

describe("sprint drafts", () => {
  it("starts a new sprint today, two weeks long, numbered after the area's sprints", () => {
    expect(
      emptySprintDraft([sprint("w1"), sprint("p1", { area: "personal" })], "work", "2026-10-19"),
    ).toEqual({ name: "Sprint 2", area: "work", startDate: "2026-10-19", endDate: "2026-11-01" });
  });

  it("renames a new sprint for its area only while the name is still the default", () => {
    const sprints = [
      sprint("w1"),
      sprint("p1", { area: "personal" }),
      sprint("p2", { area: "personal" }),
    ];
    const draft = { ...emptySprintDraft(sprints, "work", "2026-10-19"), endDate: "2026-10-30" };
    expect(withSprintDraftArea(draft, "personal", sprints)).toEqual({
      ...draft,
      name: "Sprint 3",
      area: "personal",
    });
    expect(withSprintDraftArea({ ...draft, name: "Polish" }, "personal", sprints)).toEqual({
      ...draft,
      name: "Polish",
      area: "personal",
    });
  });

  it("creates a sprint from a draft with a trimmed name", () => {
    const draft = { ...emptySprintDraft([], "personal", "2026-10-19"), name: "  Polish  " };
    expect(buildSprintCommand(draft, null, { sprintId: sprintId("new"), commandId })).toEqual({
      command: {
        type: "roadmap.sprint.create",
        commandId,
        sprintId: sprintId("new"),
        name: "Polish",
        area: "personal",
        startDate: "2026-10-19",
        endDate: "2026-11-01",
      },
    });
  });

  it("refuses a sprint with no name or one that ends before it starts", () => {
    const draft = emptySprintDraft([], "work", "2026-10-19");
    const ids = { sprintId: sprintId("new"), commandId };
    expect(buildSprintCommand({ ...draft, name: " " }, null, ids)).toEqual({
      error: "Give the sprint a name.",
    });
    expect(buildSprintCommand({ ...draft, endDate: "2026-10-18" }, null, ids)).toEqual({
      error: "A sprint cannot end before it starts.",
    });
  });

  it("updates only the fields that changed, and nothing when none did", () => {
    const existing = sprint("s1");
    const ids = { sprintId: existing.id, commandId };
    expect(
      buildSprintCommand({ ...sprintDraftFor(existing), endDate: "2026-11-06" }, existing, ids),
    ).toEqual({
      command: {
        type: "roadmap.sprint.update",
        commandId,
        sprintId: existing.id,
        patch: { endDate: "2026-11-06" },
      },
    });
    expect(buildSprintCommand(sprintDraftFor(existing), existing, ids)).toEqual({ command: null });
  });

  it("writes the sprint's dates briefly", () => {
    expect(formatSprintDates(sprint("s1"), "2026-10-19")).toBe("Oct 19 to Oct 30");
  });
});
