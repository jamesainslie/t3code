import {
  EnvironmentId,
  RoadmapItemId,
  ThreadId,
  type RoadmapItemType,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachPickerGroups, roadmapHref } from "./roadmapThread.logic";

const item = (
  id: string,
  type: RoadmapItemType,
  parentId: string | null,
  overrides: Partial<RoadmapWorkItem> = {},
): RoadmapWorkItem => ({
  id: RoadmapItemId.make(id),
  type,
  title: `Title ${id}`,
  description: "",
  parentId: parentId === null ? null : RoadmapItemId.make(parentId),
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
  focusedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
  ...overrides,
});

describe("roadmapHref", () => {
  it("opens the page, an item, or the editor under a parent", () => {
    expect(roadmapHref()).toBe("/roadmap");
    expect(roadmapHref({ view: "today" })).toBe("/roadmap");
    expect(roadmapHref({ view: "timeline" })).toBe("/roadmap?view=timeline");
    // Today does not show a selected item, so an item opens in the Outline.
    expect(roadmapHref({ item: RoadmapItemId.make("a b") })).toBe("/roadmap?view=outline&item=a+b");
    expect(roadmapHref({ view: "timeline", item: RoadmapItemId.make("a") })).toBe(
      "/roadmap?view=timeline&item=a",
    );
    expect(roadmapHref({ new: true })).toBe("/roadmap?new=1");
    expect(roadmapHref({ new: true, parent: RoadmapItemId.make("p1") })).toBe(
      "/roadmap?new=1&parent=p1",
    );
    expect(roadmapHref({ importIssue: true })).toBe("/roadmap?view=outline&import=1");
  });
});

describe("attachPickerGroups", () => {
  it("groups items under their objective in tree order, objective first", () => {
    const groups = attachPickerGroups([
      item("b", "objective", null),
      item("b2", "epic", "b"),
      item("a", "objective", null),
      item("a1", "key-result", "a"),
      item("a1x", "feature", "a1"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Title a", "Title b"]);
    expect(groups[0]?.entries.map((entry) => entry.item.id)).toEqual(["a", "a1", "a1x"]);
    expect(groups[0]?.entries.map((entry) => entry.depth)).toEqual([0, 1, 2]);
    expect(groups[0]?.entries.map((entry) => entry.path)).toEqual([
      [],
      ["Title a"],
      ["Title a", "Title a1"],
    ]);
  });

  it("puts items under no objective in one group after the objectives", () => {
    const groups = attachPickerGroups([
      item("loose", "story", null),
      item("o", "objective", null),
      item("epic", "epic", null),
      item("child", "bug", "epic"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Title o", "No objective"]);
    expect(groups[1]?.entries.map((entry) => entry.item.id)).toEqual(["epic", "child", "loose"]);
  });

  it("carries each item's effective priority", () => {
    const groups = attachPickerGroups([
      item("o", "objective", null, { priority: "p1" }),
      item("e", "epic", "o"),
    ]);
    expect(groups[0]?.entries.map((entry) => entry.priority)).toEqual([
      { priority: "p1", inherited: false },
      { priority: "p1", inherited: true },
    ]);
  });

  it("leaves out the item the thread is already on", () => {
    const thread = {
      environmentId: EnvironmentId.make("env"),
      threadId: ThreadId.make("thread"),
    };
    const groups = attachPickerGroups(
      [
        item("o", "objective", null),
        item("e", "epic", "o", {
          attachments: [{ thread, attachedAt: "2026-10-18T00:00:00.000Z" }],
        }),
      ],
      { excludeAttachedTo: thread },
    );
    expect(groups[0]?.entries.map((entry) => entry.item.id)).toEqual(["o"]);
  });
});
