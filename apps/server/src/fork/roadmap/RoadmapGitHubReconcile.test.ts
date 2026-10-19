import { assert, describe, it } from "@effect/vitest";
import {
  ROADMAP_NO_LOCAL_CHANGES,
  type RoadmapIssueSource,
  RoadmapItemId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import type { GitHubIssue } from "@lathe/source-control-github/server/GitHubIssueApi";

import { issueItemType, reconcileIssue } from "./RoadmapGitHubReconcile.ts";

const at = "2026-10-01T00:00:00.000Z";
const id = RoadmapItemId.make;

const source = (
  nodeId: string,
  overrides: Partial<RoadmapIssueSource> = {},
): RoadmapIssueSource => ({
  host: "github.com",
  owner: "acme",
  repo: "web",
  number: Number(nodeId.replace(/\D/g, "")) || 1,
  nodeId,
  url: `https://github.com/acme/web/issues/${nodeId}`,
  writable: true,
  remoteUpdatedAt: "2026-10-10T00:00:00Z",
  syncedAt: at,
  base: { title: `Item ${nodeId}`, closed: false, parentNodeId: null, blockedByNodeIds: [] },
  localChangedAt: ROADMAP_NO_LOCAL_CHANGES,
  ...overrides,
});

const item = (itemId: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: id(itemId),
  type: "story",
  title: `Item I_${itemId}`,
  description: "",
  parentId: null,
  sortKey: "n",
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
  createdAt: at,
  updatedAt: at,
  createdBy: { _tag: "github" },
  stateChangedAt: at,
  completedAt: null,
  pinnedAt: null,
  focusedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: source(`I_${itemId}`),
  pullRequests: [],
  ...overrides,
});

const remoteOf = (value: RoadmapWorkItem, overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  host: "github.com",
  owner: "acme",
  repo: "web",
  number: value.source!.number,
  nodeId: value.source!.nodeId,
  url: value.source!.url,
  title: value.source!.base.title,
  closed: value.source!.base.closed,
  updatedAt: "2026-10-10T00:00:00Z",
  writable: true,
  parentNodeId: value.source!.base.parentNodeId,
  subIssueNodeIds: [],
  blockedByNodeIds: value.source!.base.blockedByNodeIds,
  ...overrides,
});

const reconcile = (
  target: RoadmapWorkItem,
  remote: GitHubIssue,
  others: ReadonlyArray<RoadmapWorkItem> = [],
  knownNodeIds: ReadonlyArray<string> = [],
) => {
  const all = [target, ...others];
  return reconcileIssue({
    item: target,
    remote,
    items: new Map(all.map((entry) => [entry.id, entry])),
    byNodeId: new Map(
      all.flatMap((entry) => (entry.source === null ? [] : [[entry.source.nodeId, entry]])),
    ),
    knownNodeIds: new Set([
      ...knownNodeIds,
      ...all.flatMap((entry) => (entry.source === null ? [] : [entry.source.nodeId])),
    ]),
  });
};

describe("issueItemType", () => {
  it("gives an issue with sub-issues the highest type that fits, and a leaf a story or a bug", () => {
    assert.equal(issueItemType(null, true), "epic");
    assert.equal(issueItemType(null, false), "story");
    assert.equal(issueItemType("epic", true), "feature");
    assert.equal(issueItemType("feature", true), "story");
    assert.equal(issueItemType("story", false), "bug");
    assert.equal(issueItemType("story", true), "bug");
    assert.isNull(issueItemType("bug", false));
  });
});

describe("reconcileIssue", () => {
  it("changes nothing when neither side moved", () => {
    const value = item("a");
    const result = reconcile(value, remoteOf(value));
    assert.deepEqual(result.local, []);
    assert.deepEqual(result.remote, []);
    assert.deepEqual(result.notes, []);
    assert.deepEqual(result.base, value.source!.base);
  });

  describe("title", () => {
    it("copies a title changed on one side to the other", () => {
      const value = item("a");
      const fromGitHub = reconcile(value, remoteOf(value, { title: "Renamed" }));
      assert.deepEqual(fromGitHub.local, [{ kind: "title", title: "Renamed" }]);
      assert.equal(fromGitHub.base.title, "Renamed");
      const renamed = item("a", { title: "Mine" });
      const fromHere = reconcile(renamed, remoteOf(renamed));
      assert.deepEqual(fromHere.remote, [{ kind: "title", title: "Mine" }]);
      assert.equal(fromHere.base.title, "Mine");
    });

    it("lets the newer side win a conflict and says so", () => {
      const renamed = (localAt: string) =>
        item("a", {
          title: "Mine",
          source: source("I_a", {
            localChangedAt: { ...ROADMAP_NO_LOCAL_CHANGES, title: localAt },
          }),
        });
      const remoteAt = "2026-10-12T00:00:00Z";
      const localWins = renamed("2026-10-12T00:00:01.000Z");
      const kept = reconcile(
        localWins,
        remoteOf(localWins, { title: "Theirs", updatedAt: remoteAt }),
      );
      assert.deepEqual(kept.remote, [{ kind: "title", title: "Mine" }]);
      assert.deepEqual(kept.local, []);
      assert.match(kept.notes[0]!.text, /Kept "Mine" over GitHub's title "Theirs"/);

      const remoteWins = renamed("2026-10-11T23:59:59.000Z");
      const replaced = reconcile(
        remoteWins,
        remoteOf(remoteWins, { title: "Theirs", updatedAt: remoteAt }),
      );
      assert.deepEqual(replaced.local, [{ kind: "title", title: "Theirs" }]);
      assert.deepEqual(replaced.remote, []);
      assert.match(replaced.notes[0]!.text, /GitHub's title "Theirs" replaced "Mine"/);
      assert.equal(replaced.base.title, "Theirs");
    });

    it("treats the same title on both sides as agreed", () => {
      const value = item("a", { title: "Same" });
      const result = reconcile(value, remoteOf(value, { title: "Same" }));
      assert.deepEqual([result.local, result.remote, result.notes], [[], [], []]);
      assert.equal(result.base.title, "Same");
    });
  });

  describe("open or closed", () => {
    it("sets done when the issue closes and in progress when it reopens", () => {
      const open = item("a");
      assert.deepEqual(reconcile(open, remoteOf(open, { closed: true })).local, [
        { kind: "state", state: "done" },
      ]);
      const done = item("a", {
        state: "done",
        source: source("I_a", { base: { ...source("I_a").base, closed: true } }),
      });
      const reopened = reconcile(done, remoteOf(done, { closed: false }));
      assert.deepEqual(reopened.local, [{ kind: "state", state: "in-progress" }]);
      assert.isFalse(reopened.base.closed);
    });

    it("closes or reopens the issue when the item finishes or reopens here", () => {
      const done = item("a", { state: "done" });
      const closing = reconcile(done, remoteOf(done));
      assert.deepEqual(closing.remote, [{ kind: "closed", closed: true }]);
      assert.isTrue(closing.base.closed);
    });

    it("leaves a state that does not change done-ness alone", () => {
      const working = item("a", { state: "in-review" });
      assert.deepEqual(reconcile(working, remoteOf(working)).remote, []);
    });

    it("puts the issue's state back on an item it cannot write", () => {
      const done = item("a", { state: "done" });
      const result = reconcile(done, remoteOf(done, { writable: false }));
      assert.deepEqual(result.remote, []);
      assert.deepEqual(result.local, [{ kind: "state", state: "in-progress" }]);
      assert.match(result.notes[0]!.text, /cannot change issue/);
    });
  });

  describe("parent", () => {
    const epic = (itemId: string) => item(itemId, { type: "epic" });

    it("follows a new parent on GitHub when that parent is an item", () => {
      const parent = epic("p");
      const child = item("c");
      const result = reconcile(child, remoteOf(child, { parentNodeId: "I_p" }), [parent]);
      assert.deepEqual(result.local, [{ kind: "move", parentId: id("p") }]);
      assert.equal(result.base.parentNodeId, "I_p");
    });

    it("ignores a parent issue no item holds", () => {
      const child = item("c");
      const result = reconcile(child, remoteOf(child, { parentNodeId: "I_elsewhere" }));
      assert.deepEqual(result.local, []);
      assert.isNull(result.base.parentNodeId);
    });

    it("moves to the top level, keeping its area, when GitHub drops the sub-issue link", () => {
      const parent = epic("p");
      const child = item("c", {
        parentId: id("p"),
        source: source("I_c", { base: { ...source("I_c").base, parentNodeId: "I_p" } }),
      });
      const result = reconcile(child, remoteOf(child, { parentNodeId: null }), [
        { ...parent, area: "work" },
      ]);
      assert.deepEqual(result.local, [{ kind: "move", parentId: null, area: "work" }]);
    });

    it("retypes an item that cannot sit under its new parent", () => {
      const parent = item("p", { type: "story" });
      const child = item("c");
      const result = reconcile(child, remoteOf(child, { parentNodeId: "I_p" }), [parent]);
      assert.deepEqual(result.local, [{ kind: "move", parentId: id("p"), itemType: "bug" }]);
    });

    it("pushes a move under another issue, replacing the old parent", () => {
      const parent = epic("p");
      const child = item("c", { parentId: id("p") });
      const result = reconcile(child, remoteOf(child, { parentNodeId: "I_old" }), [parent]);
      assert.deepEqual(result.remote, [
        { kind: "parent", parentNodeId: "I_p", previousParentNodeId: "I_old" },
      ]);
      assert.deepEqual(result.notes, []);
    });

    it("drops the sub-issue link with a note when the item moves under a Lathe-only parent", () => {
      const issueParent = epic("p");
      const lathe = item("l", { type: "epic", source: null });
      const child = item("c", {
        parentId: id("l"),
        source: source("I_c", { base: { ...source("I_c").base, parentNodeId: "I_p" } }),
      });
      const result = reconcile(child, remoteOf(child), [issueParent, lathe]);
      assert.deepEqual(result.remote, [
        { kind: "parent", parentNodeId: null, previousParentNodeId: "I_p" },
      ]);
      assert.isNull(result.base.parentNodeId);
      assert.match(result.notes[0]!.text, /Dropped the sub-issue link to "Item I_p"/);
    });
  });

  describe("blockers", () => {
    it("links and unlinks blockers GitHub added or removed between items", () => {
      const blocker = item("b");
      const gone = item("g");
      const value = item("a", {
        blockedBy: [id("g")],
        source: source("I_a", { base: { ...source("I_a").base, blockedByNodeIds: ["I_g"] } }),
      });
      const result = reconcile(value, remoteOf(value, { blockedByNodeIds: ["I_b", "I_x"] }), [
        blocker,
        gone,
      ]);
      assert.sameDeepMembers(
        [...result.local],
        [
          { kind: "blocker", blockedById: id("b"), linked: true },
          { kind: "blocker", blockedById: id("g"), linked: false },
        ],
      );
      assert.deepEqual(result.base.blockedByNodeIds, ["I_b"]);
    });

    it("pushes blockers added or removed here", () => {
      const blocker = item("b");
      const value = item("a", { blockedBy: [id("b")] });
      const result = reconcile(value, remoteOf(value), [blocker]);
      assert.deepEqual(result.remote, [{ kind: "blocker", blockingNodeId: "I_b", blocked: true }]);
      assert.deepEqual(result.base.blockedByNodeIds, ["I_b"]);
    });
  });

  it("lists sub-issues no item holds or held", () => {
    const value = item("a");
    const result = reconcile(
      value,
      remoteOf(value, { subIssueNodeIds: ["I_new", "I_deleted", "I_a"] }),
      [],
      ["I_deleted"],
    );
    assert.deepEqual(result.newSubIssues, ["I_new"]);
  });
});
