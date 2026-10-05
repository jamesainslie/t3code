import {
  ProviderThreadId,
  ThreadId,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type ThreadDocumentComment,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { buildThreadDigest, DIGEST_LIMITS } from "./digest.ts";
import {
  assistantMessage,
  atIso,
  checkpoint,
  commandItem,
  errorItem,
  file,
  makeThread,
  proposedPlan,
  run,
  runId,
  THREAD_ID,
  todoList,
  userMessage,
} from "./testFixtures.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const digestOf = (
  thread: ReturnType<typeof makeThread>,
  options: {
    readonly callerWorktreePath?: string | null;
    readonly recentTurns?: number;
    readonly continuedFromTitle?: string | null;
    readonly comments?: ReadonlyArray<ThreadDocumentComment>;
  } = {},
) =>
  buildThreadDigest({
    thread,
    comments: options.comments ?? [],
    projectTitle: "Project",
    continuedFromTitle: options.continuedFromTitle ?? null,
    callerWorktreePath: options.callerWorktreePath ?? null,
    recentTurns: options.recentTurns ?? 3,
  });

function comment(id: string, status: ThreadDocumentComment["status"]): ThreadDocumentComment {
  return {
    id,
    filePath: `docs/${id}.md`,
    anchor: { text: "passage", start: 0, end: 7, prefix: "", suffix: "", startLine: 1, endLine: 1 },
    body: `Comment ${id}`,
    status,
    resolution: null,
    createdAt: atIso(1),
    updatedAt: atIso(1),
    resolvedAt: status === "resolved" ? atIso(2) : null,
  };
}

/** `count` completed runs, each with one prompt and one reply. */
function runsOf(count: number) {
  const ids = Array.from({ length: count }, (_, index) => runId(`run-${index + 1}`));
  return {
    ids,
    runs: ids.map((id, index) => run({ id, ordinal: index + 1, userMessageId: `u${index + 1}` })),
    messages: ids.flatMap((id, index) => [
      userMessage(`u${index + 1}`, (index + 1) * 100, `Request ${index + 1}`),
      assistantMessage(`a${index + 1}`, (index + 1) * 100 + 1, id, `Reply ${index + 1}`),
    ]),
  };
}

describe("buildThreadDigest", () => {
  it("uses the first user message as the goal and later ones as steering", () => {
    const longSteer = "steer ".repeat(200);
    const A = runId("run-a");
    const B = runId("run-b");
    const digest = digestOf(
      makeThread({
        runs: [
          run({ id: A, ordinal: 1, userMessageId: "u1" }),
          run({ id: B, ordinal: 2, userMessageId: "u2" }),
        ],
        messages: [
          userMessage("u1", 100, "Build the thread digest"),
          assistantMessage("a1", 101, A),
          userMessage("u2", 200, longSteer),
          userMessage("u3", 210, "Also cover reasoning", B),
          assistantMessage("a2", 220, B),
        ],
      }),
    );

    expect(digest.goal).toBe("Build the thread digest");
    expect(digest.steering.map((entry) => entry.turn)).toEqual([2, 2]);
    expect(byteLength(digest.steering[0]!.text)).toBeLessThanOrEqual(DIGEST_LIMITS.steeringBytes);
    expect(digest.steering[0]!.text.endsWith("…")).toBe(true);
    expect(digest.steering[1]!.text).toBe("Also cover reasoning");
  });

  it("keeps the last turns in detail and earlier ones as one-line outcomes", () => {
    const { ids, runs, messages } = runsOf(5);
    const digest = digestOf(
      makeThread({
        runs,
        messages,
        turnItems: [
          commandItem("cmd-5", 501, ids[4]!, "vp test run src/a.test.ts"),
          errorItem("err-5", 502, ids[4]!, "provider hiccup"),
        ],
        checkpoints: [checkpoint(ids[4]!, 5, [file("src/a.ts", 4, 2)])],
      }),
      { recentTurns: 2 },
    );

    expect(digest.earlierTurns.map((turn) => [turn.n, turn.outcome])).toEqual([
      [1, "Reply 1"],
      [2, "Reply 2"],
      [3, "Reply 3"],
    ]);
    expect(digest.recentTurns.map((turn) => turn.n)).toEqual([4, 5]);
    expect(digest.recentTurns[1]).toMatchObject({
      user: "Request 5",
      assistant: ["Reply 5"],
      tools: ["Bash completed: vp test run src/a.test.ts"],
      errors: ["provider hiccup"],
      files: [{ path: "src/a.ts", additions: 4, deletions: 2 }],
    });
  });

  it("reports the thread's status from its latest run and context", () => {
    const A = runId("run-a");
    const thread = (status: OrchestrationV2Run["status"]) =>
      makeThread({
        runs: [run({ id: A, ordinal: 1, userMessageId: "u1", status })],
        messages: [userMessage("u1", 100)],
        turnItems: status === "failed" ? [errorItem("err", 101, A, "rate limited")] : [],
      });

    expect(digestOf(makeThread()).header.status).toEqual({ kind: "empty" });
    expect(digestOf(thread("running")).header.status).toEqual({ kind: "running" });
    expect(digestOf(thread("interrupted")).header.status).toEqual({ kind: "interrupted" });
    expect(digestOf(thread("failed")).header.status).toEqual({
      kind: "error",
      message: "rate limited",
    });

    const providerThreadId = ProviderThreadId.make("provider-thread-1");
    const full = makeThread({
      ...thread("completed"),
      thread: { activeProviderThreadId: providerThreadId },
      providerThreads: [
        {
          id: providerThreadId,
          contextUsage: { usedTokens: 960, maxTokens: 1000 },
        } as unknown as OrchestrationV2ProviderThread,
      ],
    });
    expect(digestOf(full).header.status).toEqual({
      kind: "context-full",
      usedTokens: 960,
      maxTokens: 1000,
    });
  });

  it("lists open todos, open plans, open comments and live pull requests", () => {
    const A = runId("run-a");
    const digest = digestOf(
      makeThread({
        thread: {
          pullRequests: [
            {
              host: "github.com",
              repository: "acme/web",
              number: 7,
              url: "https://github.com/acme/web/pull/7",
              source: "manual",
              linkedAt: atIso(1),
              snapshot: null,
              stack: null,
            },
            {
              host: "github.com",
              repository: "acme/web",
              number: 8,
              url: "https://github.com/acme/web/pull/8",
              source: "stack-dismissed",
              linkedAt: atIso(1),
              snapshot: null,
              stack: null,
            },
          ] as never,
        },
        runs: [run({ id: A, ordinal: 1, userMessageId: "u1" })],
        messages: [userMessage("u1", 100)],
        plans: [
          todoList("todos-old", A, [{ text: "stale", status: "pending" }], "superseded"),
          todoList("todos", A, [
            { text: "write tests", status: "completed" },
            { text: "port digest", status: "running" },
          ]),
          proposedPlan("plan-open", A, "# Open plan"),
          proposedPlan("plan-done", A, "# Done plan", "completed"),
        ],
      }),
      { comments: [comment("open-1", "open"), comment("done-1", "resolved")] },
    );

    expect(digest.openWork.todos).toEqual(["port digest (running)"]);
    expect(digest.openWork.plans.map((plan) => plan.id)).toEqual(["plan-open"]);
    expect(digest.openWork.comments).toEqual([{ file: "docs/open-1.md", text: "Comment open-1" }]);
    expect(digest.openWork.pullRequests.map((pr) => pr.number)).toEqual([7]);
  });

  it("names the thread it continues and how its worktree relates to the caller's", () => {
    const source = ThreadId.make("thread-source");
    const digest = digestOf(
      makeThread({ thread: { continuedFromThreadId: source, worktreePath: "/repo/wt" } }),
      { continuedFromTitle: "Source thread", callerWorktreePath: "/repo/wt" },
    );
    expect(digest.header.threadId).toBe(THREAD_ID);
    expect(digest.header.continuedFrom).toEqual({ threadId: source, title: "Source thread" });
    expect(digest.header.worktreeRelation).toBe("shared");
    expect(
      digestOf(makeThread({ thread: { worktreePath: "/repo/other" } }), {
        callerWorktreePath: "/repo/wt",
      }).header.worktreeRelation,
    ).toBe("different");
  });
});
