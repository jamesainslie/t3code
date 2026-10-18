import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  RoadmapCommand,
  RoadmapError,
  RoadmapEvent,
  RoadmapStreamItem,
  RoadmapWorkItem,
} from "./roadmap.ts";

const decodeItem = Schema.decodeUnknownSync(RoadmapWorkItem);
const encodeItem = Schema.encodeSync(RoadmapWorkItem);
const decodeCommand = Schema.decodeSync(RoadmapCommand);
const decodeEvent = Schema.decodeSync(RoadmapEvent);
const decodeStreamItem = Schema.decodeUnknownSync(RoadmapStreamItem);

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
});

describe("RoadmapStreamItem", () => {
  const decode = decodeStreamItem;

  it("decodes a snapshot", () => {
    expect(decode({ type: "snapshot", sequence: 4, items: [fullItem] }).type).toBe("snapshot");
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
});

describe("RoadmapError", () => {
  it("carries a rejection code", () => {
    const error = new RoadmapError({ code: "parent_cycle", message: "Would loop." });
    expect(error.code).toBe("parent_cycle");
  });
});
