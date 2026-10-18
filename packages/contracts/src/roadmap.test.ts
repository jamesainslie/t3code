import { assert, describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  RoadmapAreaSettings,
  RoadmapCommand,
  RoadmapDispatchResult,
  RoadmapError,
  RoadmapEvent,
  RoadmapRejectionCode,
  RoadmapSprint,
  RoadmapStreamItem,
  RoadmapWorkItem,
} from "./roadmap.ts";

const decodeItem = Schema.decodeUnknownSync(RoadmapWorkItem);
const encodeItem = Schema.encodeSync(RoadmapWorkItem);
const decodeCommand = Schema.decodeSync(RoadmapCommand);
const decodeEvent = Schema.decodeSync(RoadmapEvent);
const decodeStreamItem = Schema.decodeUnknownSync(RoadmapStreamItem);
const decodeSprint = Schema.decodeUnknownSync(RoadmapSprint);
const encodeSprint = Schema.encodeSync(RoadmapSprint);
const decodeAreaSettings = Schema.decodeUnknownSync(RoadmapAreaSettings);
const decodeDispatchResult = Schema.decodeSync(RoadmapDispatchResult);

const at = "2026-10-18T09:00:00.000Z";
const thread = { environmentId: "env-home", threadId: "thread-1" };

const fullItem = {
  id: "item-1",
  type: "feature",
  title: "Build-time brand layer",
  description: "Tokens resolve **at build time**.",
  parentId: "item-0",
  sortKey: "m",
  state: "in-progress",
  priority: "p1",
  area: "work",
  dueDate: "2026-10-23",
  startDate: null,
  estimate: 3.5,
  criteria: [
    {
      id: "c1",
      text: "Brand tokens resolve at build time",
      tickedAt: at,
      tickedBy: { _tag: "agent", thread, threadTitle: "Brand layer" },
      evidence: "build log line 12",
    },
    { id: "c2", text: "Installer art", tickedAt: null, tickedBy: null, evidence: null },
  ],
  blockedBy: ["item-2"],
  externalBlockers: [{ id: "x1", text: "Design sign-off", resolvedAt: null }],
  related: ["item-3"],
  attachments: [{ thread, attachedAt: at }],
  origin: thread,
  needsReview: true,
  createdAt: at,
  updatedAt: at,
  createdBy: { _tag: "user" },
  stateChangedAt: at,
  completedAt: null,
  pinnedAt: at,
  snoozedUntil: "2026-10-20",
  sprintId: "sprint-1",
  hours: [
    { id: "h1", at, hours: 1.5, actor: { _tag: "user" }, note: "Pairing" },
    { id: "h2", at, hours: 0.25, actor: { _tag: "agent", thread, threadTitle: "x" }, note: null },
  ],
  progressNotes: [
    {
      id: "n1",
      at,
      actor: { _tag: "agent", thread, threadTitle: "x" },
      kind: "progress",
      text: "Tokens wired into the build",
      criterionId: "c1",
    },
    {
      id: "n2",
      at,
      actor: { _tag: "steward", environmentId: "env-home" },
      kind: "unsure",
      text: "No test covers the installer art yet",
      criterionId: null,
    },
  ],
  source: {
    host: "github.com",
    owner: "acme",
    repo: "web",
    number: 123,
    nodeId: "I_kwDOA",
    url: "https://github.com/acme/web/issues/123",
    writable: true,
    remoteUpdatedAt: "2026-10-18T08:00:00Z",
    syncedAt: at,
    base: {
      title: "Build-time brand layer",
      closed: false,
      parentNodeId: null,
      blockedByNodeIds: [],
    },
    localChangedAt: { title: at, closed: null, parent: null, blockedBy: null },
  },
  pullRequests: [
    {
      host: "github.com",
      repository: "acme/web",
      number: 7,
      url: "https://github.com/acme/web/pull/7",
    },
  ],
};

const sprint = {
  id: "sprint-1",
  name: "Sprint 42",
  area: "work",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
};

describe("RoadmapWorkItem", () => {
  it("round-trips a full work item", () => {
    const decoded = decodeItem(fullItem);
    expect(encodeItem(decoded)).toEqual(fullItem);
  });

  it("rejects an unknown type literal", () => {
    expect(() => decodeItem({ ...fullItem, type: "saga" })).toThrow();
  });

  it("rejects a due date with a time", () => {
    expect(() => decodeItem({ ...fullItem, dueDate: at })).toThrow();
  });

  it("rejects a negative estimate", () => {
    expect(() => decodeItem({ ...fullItem, estimate: -1 })).toThrow();
  });

  it("rejects a snooze date with a time", () => {
    expect(() => decodeItem({ ...fullItem, snoozedUntil: at })).toThrow();
  });

  it("rejects an hours entry that is not positive", () => {
    const entry = { id: "h", at, hours: 0, actor: { _tag: "user" }, note: null };
    expect(() => decodeItem({ ...fullItem, hours: [entry] })).toThrow();
  });

  it("decodes an item stored before notes with no notes", () => {
    const { progressNotes: _, ...withoutNotes } = fullItem;
    expect(decodeItem(withoutNotes).progressNotes).toEqual([]);
  });

  it("decodes an item stored before GitHub sync with no source and no pull requests", () => {
    const { source: _, pullRequests: __, ...withoutGitHub } = fullItem;
    const decoded = decodeItem(withoutGitHub);
    expect(decoded.source).toBeNull();
    expect(decoded.pullRequests).toEqual([]);
  });

  it("rejects a source with no issue number or a pull request link with no url", () => {
    expect(() => decodeItem({ ...fullItem, source: { ...fullItem.source, number: 0 } })).toThrow();
    const link = fullItem.pullRequests[0]!;
    expect(() => decodeItem({ ...fullItem, pullRequests: [{ ...link, url: "" }] })).toThrow();
  });

  it("rejects a note of an unknown kind or with blank text", () => {
    const note = fullItem.progressNotes[0]!;
    expect(() => decodeItem({ ...fullItem, progressNotes: [{ ...note, kind: "idea" }] })).toThrow();
    expect(() => decodeItem({ ...fullItem, progressNotes: [{ ...note, text: "  " }] })).toThrow();
  });
});

describe("RoadmapSprint", () => {
  it("round-trips a sprint", () => {
    const decoded = decodeSprint(sprint);
    expect(encodeSprint(decoded)).toEqual(sprint);
  });
});

describe("RoadmapAreaSettings", () => {
  const decode = decodeAreaSettings;

  it("defaults to points, Monday to Friday, and five days to go cold", () => {
    expect(decode({})).toEqual({
      unit: "points",
      workingWeekdays: [1, 2, 3, 4, 5],
      goingColdDays: 5,
    });
  });

  it("rejects an empty working week and weekdays outside Sunday to Saturday", () => {
    expect(() => decode({ workingWeekdays: [] })).toThrow();
    expect(() => decode({ workingWeekdays: [7] })).toThrow();
  });

  it("rejects an unknown unit", () => {
    expect(() => decode({ unit: "days" })).toThrow();
  });
});

describe("RoadmapStreamItem", () => {
  const decode = decodeStreamItem;

  it("decodes a snapshot", () => {
    expect(decode({ type: "snapshot", sequence: 4, items: [fullItem], sprints: [] }).type).toBe(
      "snapshot",
    );
  });

  it("decodes an upsert", () => {
    expect(decode({ type: "item.upserted", sequence: 5, item: fullItem }).type).toBe(
      "item.upserted",
    );
  });

  it("decodes a removal", () => {
    expect(decode({ type: "item.removed", sequence: 6, itemId: "item-1" })).toEqual({
      type: "item.removed",
      sequence: 6,
      itemId: "item-1",
    });
  });

  it("carries sprints in the snapshot", () => {
    const decoded = decode({ type: "snapshot", sequence: 4, items: [], sprints: [sprint] });
    expect(decoded).toMatchObject({ sprints: [sprint] });
  });

  it("decodes sprint deltas", () => {
    expect(decode({ type: "sprint.upserted", sequence: 7, sprint }).type).toBe("sprint.upserted");
    expect(decode({ type: "sprint.removed", sequence: 8, sprintId: "sprint-1" })).toEqual({
      type: "sprint.removed",
      sequence: 8,
      sprintId: "sprint-1",
    });
  });
});

describe("RoadmapCommand", () => {
  it("decodes a create with the item type under itemType", () => {
    const decoded = decodeCommand({
      type: "roadmap.item.create",
      commandId: "cmd-1",
      itemId: "item-1",
      itemType: "epic",
      title: "Rebrand",
      attachThread: thread,
    });
    expect(decoded.type).toBe("roadmap.item.create");
  });

  it("decodes an update with a nullable patch field", () => {
    const decoded = decodeCommand({
      type: "roadmap.item.update",
      commandId: "cmd-2",
      itemId: "item-1",
      patch: { priority: null, state: "done" },
    });
    expect(decoded).toMatchObject({ patch: { priority: null, state: "done" } });
  });

  it("decodes an update that moves an item into or out of a sprint", () => {
    const update = (sprintId: string | null) =>
      decodeCommand({
        type: "roadmap.item.update",
        commandId: "cmd-3",
        itemId: "item-1",
        patch: { sprintId } as never,
      });
    expect(update("sprint-1")).toMatchObject({ patch: { sprintId: "sprint-1" } });
    expect(update(null)).toMatchObject({ patch: { sprintId: null } });
  });

  it("decodes a create that puts the new item in a sprint", () => {
    const decoded = decodeCommand({
      type: "roadmap.item.create",
      commandId: "cmd-4",
      itemId: "item-2",
      itemType: "feature",
      title: "Sprinted",
      sprintId: "sprint-1",
    } as never);
    expect(decoded).toMatchObject({ sprintId: "sprint-1" });
  });

  it.each([
    { type: "roadmap.item.pin", itemId: "item-1" },
    { type: "roadmap.item.unpin", itemId: "item-1" },
    { type: "roadmap.item.snooze", itemId: "item-1", until: "2026-10-20" },
    { type: "roadmap.item.unsnooze", itemId: "item-1" },
    { type: "roadmap.hours.log", itemId: "item-1", entryId: "h1", hours: 2 },
    { type: "roadmap.hours.log", itemId: "item-1", entryId: "h1", hours: 2, note: "Review" },
    { type: "roadmap.hours.remove", itemId: "item-1", entryId: "h1" },
    { type: "roadmap.note.add", itemId: "item-1", noteId: "n1", kind: "progress", text: "Done" },
    {
      type: "roadmap.note.add",
      itemId: "item-1",
      noteId: "n1",
      kind: "drift",
      text: "Scope grew",
      criterionId: "c1",
    },
    { type: "roadmap.note.remove", itemId: "item-1", noteId: "n1" },
    {
      type: "roadmap.source.import",
      itemId: "item-1",
      itemType: "story",
      title: "Imported",
      parentId: null,
      area: "work",
      state: "backlog",
      source: fullItem.source,
    },
    {
      type: "roadmap.source.sync",
      itemId: "item-1",
      writable: false,
      remoteUpdatedAt: "2026-10-18T10:00:00Z",
      base: fullItem.source.base,
    },
    { type: "roadmap.source.unlink", itemId: "item-1" },
    { type: "roadmap.pull-request.link", itemId: "item-1", pullRequest: fullItem.pullRequests[0] },
    {
      type: "roadmap.pull-request.unlink",
      itemId: "item-1",
      host: "github.com",
      repository: "acme/web",
      number: 7,
    },
    {
      type: "roadmap.sprint.create",
      sprintId: "sprint-1",
      name: "Sprint 42",
      area: "work",
      startDate: "2026-10-19",
      endDate: "2026-10-30",
    },
    { type: "roadmap.sprint.update", sprintId: "sprint-1", patch: { name: "Renamed" } },
    { type: "roadmap.sprint.delete", sprintId: "sprint-1" },
  ])("decodes $type", (body) => {
    expect(decodeCommand({ commandId: "cmd-9", ...body } as never).type).toBe(body.type);
  });

  it("rejects a snooze with a time and hours that are not positive", () => {
    const base = { commandId: "cmd-5", itemId: "item-1" };
    expect(() =>
      decodeCommand({ ...base, type: "roadmap.item.snooze", until: at } as never),
    ).toThrow();
    expect(() =>
      decodeCommand({ ...base, type: "roadmap.hours.log", entryId: "h1", hours: -1 } as never),
    ).toThrow();
  });

  it("rejects a note of an unknown kind or with blank text", () => {
    const base = { commandId: "cmd-6", type: "roadmap.note.add", itemId: "item-1", noteId: "n1" };
    expect(() => decodeCommand({ ...base, kind: "idea", text: "x" } as never)).toThrow();
    expect(() => decodeCommand({ ...base, kind: "progress", text: " " } as never)).toThrow();
  });
});

describe("RoadmapEvent", () => {
  it("decodes a delete carrying the removed subtree", () => {
    const decoded = decodeEvent({
      type: "roadmap.item.deleted",
      eventId: "event-1",
      itemId: "item-1",
      actor: { _tag: "user" },
      occurredAt: at,
      payload: { deletedIds: ["item-1", "item-4"] },
    });
    expect(decoded.payload).toEqual({ deletedIds: ["item-1", "item-4"] });
  });

  it("decodes a sprint event, which names its sprint instead of an item", () => {
    const decoded = decodeEvent({
      type: "roadmap.sprint.deleted",
      eventId: "event-2",
      sprintId: "sprint-1",
      actor: { _tag: "user" },
      occurredAt: at,
      payload: { clearedItemIds: ["item-1"] },
    } as never);
    expect(decoded).toMatchObject({
      sprintId: "sprint-1",
      payload: { clearedItemIds: ["item-1"] },
    });
  });

  it("decodes the pin, snooze and hours events", () => {
    const base = { eventId: "event-3", itemId: "item-1", actor: { _tag: "user" }, occurredAt: at };
    for (const event of [
      { ...base, type: "roadmap.item.pinned", payload: {} },
      { ...base, type: "roadmap.item.unpinned", payload: {} },
      { ...base, type: "roadmap.item.snoozed", payload: { until: "2026-10-20" } },
      { ...base, type: "roadmap.item.unsnoozed", payload: {} },
      { ...base, type: "roadmap.hours.logged", payload: { entry: fullItem.hours[0] } },
      { ...base, type: "roadmap.hours.removed", payload: { entryId: "h1" } },
      { ...base, type: "roadmap.note.added", payload: { note: fullItem.progressNotes[1] } },
      { ...base, type: "roadmap.note.removed", payload: { noteId: "n1" } },
      {
        ...base,
        type: "roadmap.source.synced",
        payload: {
          writable: true,
          remoteUpdatedAt: "2026-10-18T10:00:00Z",
          syncedAt: at,
          base: fullItem.source.base,
        },
      },
      { ...base, type: "roadmap.source.unlinked", payload: {} },
      {
        ...base,
        type: "roadmap.pull-request.linked",
        payload: { pullRequest: fullItem.pullRequests[0] },
      },
      {
        ...base,
        type: "roadmap.pull-request.unlinked",
        payload: { host: "github.com", repository: "acme/web", number: 7 },
      },
    ]) {
      expect(decodeEvent(event as never).type).toBe(event.type);
    }
  });

  it("decodes a created event stored before notes, giving the item no notes", () => {
    const { progressNotes: _, ...withoutNotes } = fullItem;
    const decoded = decodeEvent({
      type: "roadmap.item.created",
      eventId: "event-4",
      itemId: "item-1",
      actor: { _tag: "user" },
      occurredAt: at,
      payload: { item: withoutNotes },
    } as never);
    assert(decoded.type === "roadmap.item.created");
    expect(decoded.payload.item.progressNotes).toEqual([]);
  });
});

describe("RoadmapDispatchResult", () => {
  it("names no item for a sprint command", () => {
    expect(decodeDispatchResult({ sequence: 3, itemId: null })).toEqual({
      sequence: 3,
      itemId: null,
    });
  });
});

describe("RoadmapRejectionCode", () => {
  it("covers the pin limit, actor refusals and invalid requests", () => {
    for (const code of ["pin_limit", "forbidden_actor", "invalid_request", "read_only_source"]) {
      expect(RoadmapRejectionCode.literals).toContain(code);
    }
  });
});

describe("RoadmapError", () => {
  it("carries a rejection code", () => {
    const error = new RoadmapError({ code: "parent_cycle", message: "Would loop." });
    expect(error.code).toBe("parent_cycle");
  });
});
