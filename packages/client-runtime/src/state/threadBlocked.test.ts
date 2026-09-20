import { ThreadId, TurnId, type ThreadDependency } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canAddDependency,
  compareBlockedThreads,
  dependencyWaitLabel,
  effectiveBlocked,
  isDependencyCandidate,
  threadUnblockedAt,
  type ThreadDependencyShell,
} from "./threadSettled.ts";

const NOW = "2026-04-10T12:00:00.000Z";
const LINKED_AT = "2026-04-10T09:00:00.000Z";
const BEFORE_LINK = "2026-04-10T08:00:00.000Z";
const AFTER_LINK = "2026-04-10T10:00:00.000Z";

const A = ThreadId.make("thread-a");
const B = ThreadId.make("thread-b");
const C = ThreadId.make("thread-c");

function link(threadId: ThreadId, satisfiedAt: string | null = null): ThreadDependency {
  return { threadId, linkedAt: LINKED_AT, satisfiedAt, satisfiedReason: null };
}

function makeShell(input: {
  readonly dependencies?: ReadonlyArray<ThreadDependency>;
  readonly pending?: "approval" | "user-input";
  readonly sessionStatus?: "running" | "ready" | "error";
  readonly sessionUpdatedAt?: string;
  readonly turnCompletedAt?: string;
}): ThreadDependencyShell {
  return {
    dependencies: input.dependencies ?? [],
    hasPendingApprovals: input.pending === "approval",
    hasPendingUserInput: input.pending === "user-input",
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId: A,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: input.sessionStatus === "error" ? "boom" : null,
            updatedAt: input.sessionUpdatedAt ?? AFTER_LINK,
          },
    latestTurn:
      input.turnCompletedAt === undefined
        ? null
        : {
            turnId: TurnId.make("turn-1"),
            state: "completed",
            requestedAt: BEFORE_LINK,
            startedAt: null,
            completedAt: input.turnCompletedAt,
            assistantMessageId: null,
          },
  };
}

describe("effectiveBlocked", () => {
  it("is blocked with an open link and no raised hand", () => {
    expect(effectiveBlocked(makeShell({ dependencies: [link(B)] }))).toBe(true);
  });

  it("is not blocked without links or once every link is satisfied", () => {
    expect(effectiveBlocked(makeShell({}))).toBe(false);
    expect(effectiveBlocked(makeShell({ dependencies: [link(B, AFTER_LINK)] }))).toBe(false);
  });

  it("a pending request raises the hand", () => {
    expect(effectiveBlocked(makeShell({ dependencies: [link(B)], pending: "approval" }))).toBe(
      false,
    );
  });

  it("only a fresh session error raises the hand", () => {
    expect(effectiveBlocked(makeShell({ dependencies: [link(B)], sessionStatus: "error" }))).toBe(
      false,
    );
    expect(
      effectiveBlocked(
        makeShell({
          dependencies: [link(B)],
          sessionStatus: "error",
          sessionUpdatedAt: BEFORE_LINK,
        }),
      ),
    ).toBe(true);
  });

  it("only a turn completed after the newest link raises the hand", () => {
    expect(
      effectiveBlocked(makeShell({ dependencies: [link(B)], turnCompletedAt: AFTER_LINK })),
    ).toBe(false);
    expect(
      effectiveBlocked(makeShell({ dependencies: [link(B)], turnCompletedAt: BEFORE_LINK })),
    ).toBe(true);
  });
});

describe("threadUnblockedAt", () => {
  it("is null without links or while still waiting", () => {
    expect(threadUnblockedAt(makeShell({}))).toBeNull();
    expect(threadUnblockedAt(makeShell({ dependencies: [link(B)] }))).toBeNull();
  });

  it("reports the latest satisfaction once every link is satisfied", () => {
    expect(
      threadUnblockedAt(makeShell({ dependencies: [link(B, AFTER_LINK), link(C, NOW)] })),
    ).toBe(NOW);
  });

  it("reports the raised-hand trigger while links are still open", () => {
    expect(
      threadUnblockedAt(makeShell({ dependencies: [link(B)], turnCompletedAt: AFTER_LINK })),
    ).toBe(AFTER_LINK);
  });
});

describe("canAddDependency", () => {
  const base = {
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestUserMessageAt: null,
    latestTurn: null,
    session: null,
  };

  it("refuses a synced thread and otherwise follows canSnooze", () => {
    expect(canAddDependency({ ...base, id: ThreadId.make("t3sync-x") }, { now: NOW })).toBe(false);
    expect(canAddDependency({ ...base, id: A }, { now: NOW })).toBe(true);
    expect(canAddDependency({ ...base, id: A, hasPendingApprovals: true }, { now: NOW })).toBe(
      false,
    );
  });
});

describe("isDependencyCandidate", () => {
  const threads = [
    { id: A, dependencies: [] },
    { id: B, dependencies: [link(C)] },
    { id: C, dependencies: [link(A)] },
  ];
  const blocked = { id: A, dependencies: [] };

  it("excludes itself, archived, synced, already linked, and cycles", () => {
    expect(isDependencyCandidate(threads, blocked, { id: A, archivedAt: null })).toBe(false);
    expect(isDependencyCandidate(threads, blocked, { id: B, archivedAt: NOW })).toBe(false);
    expect(
      isDependencyCandidate(threads, blocked, { id: ThreadId.make("t3sync-x"), archivedAt: null }),
    ).toBe(false);
    expect(
      isDependencyCandidate(
        threads,
        { id: A, dependencies: [link(C)] },
        { id: C, archivedAt: null },
      ),
    ).toBe(false);
    // B waits on C which waits on A: A waiting on B closes the loop.
    expect(isDependencyCandidate(threads, blocked, { id: B, archivedAt: null })).toBe(false);
  });

  it("accepts a thread that does not loop back", () => {
    const acyclic = [
      { id: A, dependencies: [] },
      { id: B, dependencies: [] },
    ];
    expect(isDependencyCandidate(acyclic, blocked, { id: B, archivedAt: null })).toBe(true);
  });
});

describe("dependencyWaitLabel", () => {
  const titles = new Map<ThreadId, string>([[B, "Fix the build"]]);
  const resolve = (id: ThreadId) => titles.get(id) ?? null;

  it("names one thread, counts several, and is null when not waiting", () => {
    expect(dependencyWaitLabel({ dependencies: [] }, resolve)).toBeNull();
    expect(dependencyWaitLabel({ dependencies: [link(B)] }, resolve)).toBe(
      "Waiting on Fix the build",
    );
    expect(dependencyWaitLabel({ dependencies: [link(C)] }, resolve)).toBe(
      "Waiting on another thread",
    );
    expect(dependencyWaitLabel({ dependencies: [link(B), link(C)] }, resolve)).toBe(
      "Waiting on 2 threads",
    );
  });
});

describe("compareBlockedThreads", () => {
  it("orders the most recently parked thread first", () => {
    const older = { dependencies: [{ ...link(B), linkedAt: BEFORE_LINK }] };
    const newer = { dependencies: [link(C)] };
    expect([older, newer].sort(compareBlockedThreads)).toEqual([newer, older]);
  });
});
