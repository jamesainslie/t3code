import { describe, expect, it } from "vite-plus/test";

import { ThreadId } from "./baseSchemas.ts";
import {
  applyThreadDependenciesRemoved,
  applyThreadDependencyAdded,
  applyThreadDependencySatisfied,
  threadDependencyWouldCycle,
  unsatisfiedThreadDependencies,
} from "./threadDependencies.ts";

const a = ThreadId.make("thread-a");
const b = ThreadId.make("thread-b");
const c = ThreadId.make("thread-c");
const NOW = "2026-09-19T00:00:00.000Z";

function link(threadId: ThreadId, satisfiedAt: string | null = null) {
  return { threadId, linkedAt: NOW, satisfiedAt, satisfiedReason: null } as const;
}

describe("threadDependencyWouldCycle", () => {
  it("rejects a thread depending on itself", () => {
    expect(threadDependencyWouldCycle([{ id: a, dependencies: [] }], a, a)).toBe(true);
  });

  it("detects a direct cycle", () => {
    const threads = [
      { id: a, dependencies: [] },
      { id: b, dependencies: [link(a)] },
    ];
    expect(threadDependencyWouldCycle(threads, a, b)).toBe(true);
  });

  it("detects a transitive cycle", () => {
    const threads = [
      { id: a, dependencies: [] },
      { id: b, dependencies: [link(c)] },
      { id: c, dependencies: [link(a)] },
    ];
    expect(threadDependencyWouldCycle(threads, a, b)).toBe(true);
  });

  it("ignores satisfied links when walking", () => {
    const threads = [
      { id: a, dependencies: [] },
      { id: b, dependencies: [link(a, NOW)] },
    ];
    expect(threadDependencyWouldCycle(threads, a, b)).toBe(false);
  });

  it("allows a chain that does not return", () => {
    const threads = [
      { id: a, dependencies: [] },
      { id: b, dependencies: [link(c)] },
      { id: c, dependencies: [] },
    ];
    expect(threadDependencyWouldCycle(threads, a, b)).toBe(false);
  });

  it("treats a missing dependencies field as no links", () => {
    const threads = [{ id: a }, { id: b }];
    expect(threadDependencyWouldCycle(threads, a, b)).toBe(false);
  });
});

describe("apply transforms", () => {
  const LATER = "2026-09-19T01:00:00.000Z";

  it("added drops satisfied links and replaces an existing link to the same thread", () => {
    const result = applyThreadDependencyAdded([link(b, NOW), link(c)], {
      dependsOnThreadId: c,
      linkedAt: LATER,
    });
    expect(result).toEqual([
      { threadId: c, linkedAt: LATER, satisfiedAt: null, satisfiedReason: null },
    ]);
  });

  it("added works from an undefined list", () => {
    expect(applyThreadDependencyAdded(undefined, { dependsOnThreadId: b, linkedAt: NOW })).toEqual([
      link(b),
    ]);
  });

  it("removed filters only the named ids", () => {
    expect(
      applyThreadDependenciesRemoved([link(b), link(c)], { dependsOnThreadIds: [c, a] }),
    ).toEqual([link(b)]);
  });

  it("satisfied stamps the open link and leaves others alone", () => {
    const result = applyThreadDependencySatisfied([link(b), link(c)], {
      dependsOnThreadId: b,
      satisfiedAt: LATER,
      reason: "turn-finished",
    });
    expect(result).toEqual([
      { threadId: b, linkedAt: NOW, satisfiedAt: LATER, satisfiedReason: "turn-finished" },
      link(c),
    ]);
  });

  it("satisfied does not restamp an already satisfied link", () => {
    const already = link(b, NOW);
    expect(
      applyThreadDependencySatisfied([already], {
        dependsOnThreadId: b,
        satisfiedAt: LATER,
        reason: "archived",
      }),
    ).toEqual([already]);
  });
});

describe("unsatisfiedThreadDependencies", () => {
  it("returns only links without a satisfiedAt", () => {
    const open = link(b);
    expect(unsatisfiedThreadDependencies({ dependencies: [open, link(c, NOW)] })).toEqual([open]);
    expect(unsatisfiedThreadDependencies({})).toEqual([]);
  });
});
