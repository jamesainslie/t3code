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
  parentPath,
  roadmapActorLabel,
  roadmapCardOpen,
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
