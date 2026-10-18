import type { EnvironmentThreadShell } from "@lathe/client-runtime/state/models";
import type {
  RoadmapTodayCapacity,
  RoadmapTodaySection,
} from "@lathe/client-runtime/roadmap/today";
import {
  EnvironmentId,
  ProjectId,
  RoadmapError,
  RoadmapItemId,
  ThreadId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parseTodayLastOpenedAt,
  roadmapPinFailure,
  roadmapReviewRequests,
  roadmapReviewTargets,
  roadmapSnoozeChoices,
  roadmapThreadSignals,
  roadmapTodayThreadOf,
  roadmapTodayThreadRefs,
  roadmapTodayThreadKey,
  roadmapUnitAmount,
  splitTodayAtCapacity,
  todayCapacityText,
  todayEstimateText,
  todayHeaderDate,
  todayOpenThreads,
  todayReasonTone,
  todayShortDate,
  type RoadmapTodayThread,
} from "./roadmapToday.logic";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");
const ref = (environmentId: EnvironmentId, threadId: string): RoadmapThreadRef => ({
  environmentId,
  threadId: ThreadId.make(threadId),
});
const attached = (thread: RoadmapThreadRef) => ({
  thread,
  attachedAt: "2026-10-18T00:00:00.000Z",
});

const item = (id: string, overrides: Partial<RoadmapWorkItem> = {}): RoadmapWorkItem => ({
  id: RoadmapItemId.make(id),
  type: "story",
  title: `Item ${id}`,
  description: "",
  parentId: null,
  sortKey: id,
  state: "in-progress",
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

// Only the fields Today reads; the rest of a shell is irrelevant to it.
const shell = (
  thread: RoadmapThreadRef,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell =>
  ({
    environmentId: thread.environmentId,
    id: thread.threadId,
    projectId: ProjectId.make("project-1"),
    latestRun: null,
    runtime: null,
    interactionMode: "default",
    latestUserAuthoredMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pullRequests: [],
    linkedPullRequest: null,
    lastVisitedAt: "2026-10-18T10:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  }) as unknown as EnvironmentThreadShell;

const run = (completedAt: string | null) =>
  ({ completedAt }) as unknown as EnvironmentThreadShell["latestRun"];

const todayThread = (
  thread: RoadmapThreadRef,
  overrides: Partial<RoadmapTodayThread> = {},
): RoadmapTodayThread => ({
  ref: thread,
  projectId: ProjectId.make("project-1"),
  latestActivityAt: null,
  awaiting: null,
  pullRequestUrls: [],
  ...overrides,
});

const threadMap = (threads: ReadonlyArray<RoadmapTodayThread>) =>
  new Map(threads.map((thread) => [roadmapTodayThreadKey(thread.ref), thread]));

describe("roadmapTodayThreadRefs", () => {
  it("lists each thread attached to an open item once, in a stable order", () => {
    const t1 = ref(envB, "t1");
    const t2 = ref(envA, "t2");
    const t3 = ref(envA, "t3");
    const refs = roadmapTodayThreadRefs([
      item("a", { attachments: [attached(t1), attached(t2)] }),
      item("b", { attachments: [attached(t1)] }),
      item("done", { state: "done", attachments: [attached(t3)] }),
    ]);
    expect(refs).toEqual([t2, t1]);
  });
});

describe("roadmapTodayThreadOf", () => {
  const thread = ref(envA, "t1");

  it("ranks an approval above a question, a plan and a finished turn", () => {
    expect(
      roadmapTodayThreadOf(
        shell(thread, {
          hasPendingApprovals: true,
          hasPendingUserInput: true,
          hasActionableProposedPlan: true,
        }),
        undefined,
      ).awaiting,
    ).toBe("approval");
    expect(
      roadmapTodayThreadOf(
        shell(thread, { hasPendingUserInput: true, hasActionableProposedPlan: true }),
        undefined,
      ).awaiting,
    ).toBe("user-input");
    expect(
      roadmapTodayThreadOf(shell(thread, { hasActionableProposedPlan: true }), undefined).awaiting,
    ).toBe("plan-ready");
  });

  it("counts a turn that finished after the last visit as waiting", () => {
    const finished = shell(thread, { latestRun: run("2026-10-18T11:00:00.000Z") });
    expect(roadmapTodayThreadOf(finished, undefined).awaiting).toBe("turn-finished");
    const seen = shell(thread, {
      latestRun: run("2026-10-18T09:00:00.000Z"),
    });
    expect(roadmapTodayThreadOf(seen, undefined).awaiting).toBeNull();
  });

  it("falls back to the local visit when the server does not track visits", () => {
    const { lastVisitedAt: _tracked, ...untracked } = shell(thread, {
      latestRun: run("2026-10-18T11:00:00.000Z"),
    });
    const finished = untracked as EnvironmentThreadShell;
    expect(roadmapTodayThreadOf(finished, "2026-10-18T12:00:00.000Z").awaiting).toBeNull();
    expect(roadmapTodayThreadOf(finished, "2026-10-18T10:00:00.000Z").awaiting).toBe(
      "turn-finished",
    );
  });

  it("never reports an archived thread as waiting, but keeps its activity", () => {
    const archived = shell(thread, {
      hasPendingApprovals: true,
      latestUserAuthoredMessageAt: "2026-10-17T08:00:00.000Z",
      archivedAt: "2026-10-18T00:00:00.000Z",
    });
    const result = roadmapTodayThreadOf(archived, undefined);
    expect(result.awaiting).toBeNull();
    expect(result.latestActivityAt).toBe("2026-10-17T08:00:00.000Z");
  });

  it("takes the later of the finished run and the user's last message as activity", () => {
    const result = roadmapTodayThreadOf(
      shell(thread, {
        latestRun: run("2026-10-16T08:00:00.000Z"),
        latestUserAuthoredMessageAt: "2026-10-17T08:00:00.000Z",
      }),
      undefined,
    );
    expect(result.latestActivityAt).toBe("2026-10-17T08:00:00.000Z");
  });

  it("collects linked pull request URLs, skipping dismissed stack members", () => {
    const link = (url: string, source: string) => ({ url, source }) as never;
    const result = roadmapTodayThreadOf(
      shell(thread, {
        pullRequests: [
          link("https://github.com/o/r/pull/1", "manual"),
          link("https://github.com/o/r/pull/2", "stack-dismissed"),
        ],
        linkedPullRequest: {
          projectId: ProjectId.make("project-1"),
          repository: "o/r",
          number: 3,
          url: "https://github.com/o/r/pull/3",
        },
      }),
      undefined,
    );
    expect(result.pullRequestUrls).toEqual([
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/3",
    ]);
  });
});

describe("roadmapThreadSignals", () => {
  it("joins every attached thread: the latest activity and the most urgent wait", () => {
    const t1 = ref(envA, "t1");
    const t2 = ref(envA, "t2");
    const signals = roadmapThreadSignals(
      [
        item("a", { attachments: [attached(t1), attached(t2)] }),
        item("unknown", { attachments: [attached(ref(envB, "gone"))] }),
        item("bare"),
      ],
      threadMap([
        todayThread(t1, {
          latestActivityAt: "2026-10-17T08:00:00.000Z",
          awaiting: "turn-finished",
        }),
        todayThread(t2, { latestActivityAt: "2026-10-18T08:00:00.000Z", awaiting: "approval" }),
      ]),
    );
    expect(signals.get(RoadmapItemId.make("a"))).toEqual({
      latestActivityAt: "2026-10-18T08:00:00.000Z",
      awaiting: { reason: "approval", thread: t2 },
    });
    expect(signals.has(RoadmapItemId.make("unknown"))).toBe(false);
    expect(signals.has(RoadmapItemId.make("bare"))).toBe(false);
  });
});

describe("roadmapReviewTargets", () => {
  it("asks each environment once, only for projects whose threads link pull requests", () => {
    const targets = roadmapReviewTargets([
      todayThread(ref(envB, "t1"), {
        projectId: ProjectId.make("p2"),
        pullRequestUrls: ["https://github.com/o/r/pull/1"],
      }),
      todayThread(ref(envA, "t2"), {
        projectId: ProjectId.make("p9"),
        pullRequestUrls: ["https://github.com/o/r/pull/2"],
      }),
      todayThread(ref(envA, "t3"), {
        projectId: ProjectId.make("p1"),
        pullRequestUrls: ["https://github.com/o/r/pull/3"],
      }),
      todayThread(ref(envA, "t4"), {
        projectId: ProjectId.make("p1"),
        pullRequestUrls: ["https://github.com/o/r/pull/4"],
      }),
      todayThread(ref(envA, "t5"), { projectId: ProjectId.make("p5") }),
    ]);
    expect(targets).toEqual([
      {
        environmentId: envA,
        input: { state: "open", involvement: "reviewing", projectIds: ["p1", "p9"] },
      },
      {
        environmentId: envB,
        input: { state: "open", involvement: "reviewing", projectIds: ["p2"] },
      },
    ]);
  });

  it("asks nothing when no attached thread links a pull request", () => {
    expect(roadmapReviewTargets([todayThread(ref(envA, "t1"))])).toEqual([]);
  });
});

describe("roadmapReviewRequests", () => {
  it("joins open pull requests waiting on the viewer to items through their threads", () => {
    const t1 = ref(envA, "t1");
    const t2 = ref(envA, "t2");
    const requests = roadmapReviewRequests(
      [
        item("a", { attachments: [attached(t1), attached(t2)] }),
        item("b", { attachments: [attached(t2)] }),
      ],
      threadMap([
        todayThread(t1, {
          pullRequestUrls: ["https://GitHub.com/o/r/pull/1/", "https://github.com/o/r/pull/9"],
        }),
        todayThread(t2, { pullRequestUrls: ["https://github.com/o/r/pull/1"] }),
      ]),
      [
        { url: "https://github.com/o/r/pull/1", state: "open", viewerReviewRequested: true },
        { url: "https://github.com/o/r/pull/9", state: "open", viewerReviewRequested: false },
      ],
    );
    expect(requests.get(RoadmapItemId.make("a"))).toEqual(["https://github.com/o/r/pull/1"]);
    expect(requests.get(RoadmapItemId.make("b"))).toEqual(["https://github.com/o/r/pull/1"]);
  });

  it("leaves out items with nothing to review", () => {
    const t1 = ref(envA, "t1");
    const requests = roadmapReviewRequests(
      [item("a", { attachments: [attached(t1)] })],
      threadMap([todayThread(t1, { pullRequestUrls: ["https://github.com/o/r/pull/1"] })]),
      [{ url: "https://github.com/o/r/pull/1", state: "merged", viewerReviewRequested: true }],
    );
    expect(requests.size).toBe(0);
  });
});

describe("roadmapSnoozeChoices", () => {
  it("offers tomorrow, next Monday and a week out from a Monday", () => {
    expect(roadmapSnoozeChoices("2026-10-19")).toEqual([
      { id: "tomorrow", label: "Tomorrow", until: "2026-10-20", hint: "Tue, Oct 20" },
      { id: "next-monday", label: "Next Monday", until: "2026-10-26", hint: "Mon, Oct 26" },
      { id: "week", label: "In a week", until: "2026-10-26", hint: "Mon, Oct 26" },
    ]);
  });

  it("lands next Monday on the coming Monday from a Friday and a Sunday", () => {
    const nextMonday = (today: string) =>
      roadmapSnoozeChoices(today).find((choice) => choice.id === "next-monday")?.until;
    expect(nextMonday("2026-10-23")).toBe("2026-10-26");
    expect(nextMonday("2026-10-18")).toBe("2026-10-19");
  });
});

describe("todayHeaderDate", () => {
  it("names the weekday and the date", () => {
    expect(todayHeaderDate("2026-10-19")).toBe("Monday, Oct 19");
    expect(todayHeaderDate("2026-10-18")).toBe("Sunday, Oct 18");
  });
});

describe("todayShortDate", () => {
  it("abbreviates the weekday", () => {
    expect(todayShortDate("2026-11-02")).toBe("Mon, Nov 2");
  });
});

describe("roadmapUnitAmount", () => {
  it("abbreviates points and hours and spells out items and criteria", () => {
    expect(roadmapUnitAmount(1, "points")).toBe("1 pt");
    expect(roadmapUnitAmount(5, "points")).toBe("5 pts");
    expect(roadmapUnitAmount(13 / 3, "points")).toBe("4.3 pts");
    expect(roadmapUnitAmount(2.5, "hours")).toBe("2.5 h");
    expect(roadmapUnitAmount(1, "items")).toBe("1 item");
    expect(roadmapUnitAmount(3, "items")).toBe("3 items");
    expect(roadmapUnitAmount(1, "criteria")).toBe("1 criterion");
    expect(roadmapUnitAmount(2, "criteria")).toBe("2 criteria");
  });
});

describe("todayCapacityText", () => {
  const capacity = (
    work: number | null,
    personal: number | null,
  ): Record<"work" | "personal", RoadmapTodayCapacity> => ({
    work: { area: "work", unit: "points", perDay: work, used: 0 },
    personal: { area: "personal", unit: "hours", perDay: personal, used: 0 },
  });

  it("lists each area that has a velocity", () => {
    expect(todayCapacityText(capacity(5, 4))).toBe("capacity Work 5 pts, Personal 4 h");
    expect(todayCapacityText(capacity(null, 4))).toBe("capacity Personal 4 h");
  });

  it("says nothing when no area has enough history", () => {
    expect(todayCapacityText(capacity(null, null))).toBeNull();
  });
});

describe("todayEstimateText", () => {
  it("shows the remaining estimate, and a hint where work has none", () => {
    expect(todayEstimateText({ estimate: 3, noEstimate: false }, "points")).toEqual({
      amount: "3 pts",
      hint: null,
    });
    expect(todayEstimateText({ estimate: null, noEstimate: true }, "points")).toEqual({
      amount: null,
      hint: "no estimate",
    });
    expect(todayEstimateText({ estimate: 2, noEstimate: true }, "points")).toEqual({
      amount: "2 pts",
      hint: "part unestimated",
    });
  });
});

describe("todayReasonTone", () => {
  it("marks overdue work red and slipping work amber", () => {
    expect(todayReasonTone({ section: "due", reason: "Overdue, was due Fri" })).toBe("destructive");
    expect(todayReasonTone({ section: "due", reason: "Due Wed, forecast Fri, at risk" })).toBe(
      "warning",
    );
    expect(todayReasonTone({ section: "due", reason: "Due today, late" })).toBe("warning");
    expect(todayReasonTone({ section: "due", reason: "Due tomorrow" })).toBe("muted");
    expect(todayReasonTone({ section: "cold", reason: "P0, untouched 6 working days" })).toBe(
      "muted",
    );
  });
});

describe("splitTodayAtCapacity", () => {
  const row = (id: string, section: RoadmapTodaySection["id"], beyondToday: boolean) => ({
    itemId: RoadmapItemId.make(id),
    section,
    reason: "",
    area: "work" as const,
    estimate: null,
    noEstimate: false,
    beyondToday,
  });

  it("puts every row past the line below one divider, keeping section order", () => {
    const sections: ReadonlyArray<RoadmapTodaySection> = [
      { id: "waiting", title: "Waiting on you", rows: [row("w", "waiting", false)] },
      {
        id: "due",
        title: "Due or slipping",
        rows: [row("d1", "due", false), row("d2", "due", true)],
      },
      { id: "cold", title: "Going cold", rows: [row("c", "cold", true)] },
    ];
    const split = splitTodayAtCapacity(sections);
    expect(split.above.map((section) => [section.id, section.rows.map((r) => r.itemId)])).toEqual([
      ["waiting", ["w"]],
      ["due", ["d1"]],
    ]);
    expect(split.beyond.map((section) => [section.id, section.rows.map((r) => r.itemId)])).toEqual([
      ["due", ["d2"]],
      ["cold", ["c"]],
    ]);
  });
});

describe("roadmapPinFailure", () => {
  it("explains a full set of picks", () => {
    const failure = roadmapPinFailure(
      new RoadmapError({
        code: "pin_limit",
        message: "Today holds 3 picks. Unpin one of A first.",
      }),
    );
    expect(failure).toEqual({
      title: "Today already has three picks",
      description: "Today holds 3 picks. Unpin one of A first.",
    });
  });

  it("falls back to the refusal's own message", () => {
    expect(roadmapPinFailure(new Error("offline"))).toEqual({
      title: "Could not pin",
      description: "offline",
    });
  });
});

describe("todayOpenThreads", () => {
  it("opens the thread that waits on the user, else every attached thread", () => {
    const t1 = ref(envA, "t1");
    const t2 = ref(envA, "t2");
    const withBoth = item("a", { attachments: [attached(t1), attached(t2)] });
    expect(
      todayOpenThreads(withBoth, {
        latestActivityAt: null,
        awaiting: { reason: "approval", thread: t2 },
      }),
    ).toEqual([t2]);
    expect(todayOpenThreads(withBoth, undefined)).toEqual([t1, t2]);
    expect(todayOpenThreads(item("bare"), undefined)).toEqual([]);
  });
});

describe("parseTodayLastOpenedAt", () => {
  it("accepts a stored timestamp and rejects anything else", () => {
    expect(parseTodayLastOpenedAt("2026-10-18T10:00:00.000Z")).toBe("2026-10-18T10:00:00.000Z");
    expect(parseTodayLastOpenedAt(null)).toBeNull();
    expect(parseTodayLastOpenedAt("yesterday")).toBeNull();
  });
});
