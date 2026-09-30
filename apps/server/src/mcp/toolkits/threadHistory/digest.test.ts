import type { OrchestrationProposedPlan, ThreadDocumentComment } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { buildThreadDigest, DIGEST_LIMITS } from "./digest.ts";
import {
  activity,
  assistantMessage,
  at,
  checkpoint,
  latestTurn,
  makeThread,
  reasoningMessage,
  THREAD_ID,
  turn,
  userMessage,
} from "./testFixtures.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).length;

const digestOf = (
  thread: ReturnType<typeof makeThread>,
  options: { readonly callerWorktreePath?: string | null; readonly recentTurns?: number } = {},
) =>
  buildThreadDigest({
    thread,
    projectTitle: "Project",
    callerWorktreePath: options.callerWorktreePath ?? null,
    recentTurns: options.recentTurns ?? 3,
  });

function plan(id: string, implementedAt: string | null): OrchestrationProposedPlan {
  return {
    id,
    turnId: null,
    planMarkdown: `# Plan ${id}\n\nDo the thing.`,
    implementedAt,
    implementationThreadId: null,
    createdAt: at(1),
    updatedAt: at(1),
  };
}

function comment(id: string, status: ThreadDocumentComment["status"]): ThreadDocumentComment {
  return {
    id,
    filePath: `docs/${id}.md`,
    anchor: { text: "passage", start: 0, end: 7, prefix: "", suffix: "", startLine: 1, endLine: 1 },
    body: `Comment ${id}`,
    status,
    resolution: null,
    createdAt: at(1),
    updatedAt: at(1),
    resolvedAt: status === "resolved" ? at(2) : null,
  };
}

describe("buildThreadDigest", () => {
  it("uses the first user message as the goal and later ones as steering", () => {
    const longSteer = "steer ".repeat(200);
    const digest = digestOf(
      makeThread({
        messages: [
          userMessage("u1", 1, "Build the thread digest"),
          assistantMessage("a1", 2, turn("t1")),
          assistantMessage("a2", 3, turn("t2")),
          userMessage("u2", 4, longSteer),
          assistantMessage("a3", 5, turn("t3")),
          userMessage("u3", 6, "Also cover reasoning"),
        ],
      }),
    );

    expect(digest.goal).toBe("Build the thread digest");
    expect(digest.steering.map((entry) => entry.turn)).toEqual([3, 4]);
    expect(byteLength(digest.steering[0]!.text)).toBeLessThanOrEqual(DIGEST_LIMITS.steeringBytes);
    expect(digest.steering[0]!.text.endsWith("…")).toBe(true);
    expect(digest.steering[1]!.text).toBe("Also cover reasoning");
  });

  it("reports context-full when the last context-window activity is at 95 percent", () => {
    const A = turn("t1");
    const contextWindow = (id: string, t: number, usedTokens: number) =>
      activity({
        id,
        t,
        kind: "context-window.updated",
        turnId: A,
        payload: { usedTokens, maxTokens: 1000 },
      });
    const messages = [userMessage("u1", 1), assistantMessage("a1", 2, A)];

    const full = digestOf(
      makeThread({
        messages,
        activities: [contextWindow("c1", 3, 400), contextWindow("c2", 4, 950)],
        latestTurn: latestTurn(A, "completed"),
      }),
    );
    expect(full.header.status).toEqual({ kind: "context-full", usedTokens: 950, maxTokens: 1000 });

    // Only the last reading counts, so a compacted window is no longer full.
    const compacted = digestOf(
      makeThread({
        messages,
        activities: [contextWindow("c1", 3, 990), contextWindow("c2", 4, 300)],
        latestTurn: latestTurn(A, "completed"),
      }),
    );
    expect(compacted.header.status).toEqual({ kind: "completed" });
  });

  it("reports empty for a thread with no turns", () => {
    const digest = digestOf(makeThread());

    expect(digest.header.status).toEqual({ kind: "empty" });
    expect(digest.goal).toBeNull();
    expect(digest.earlierTurns).toEqual([]);
    expect(digest.recentTurns).toEqual([]);
  });

  it("reports running while the latest turn runs", () => {
    const A = turn("t1");
    const digest = digestOf(
      makeThread({
        messages: [userMessage("u1", 1), assistantMessage("a1", 2, A)],
        latestTurn: latestTurn(A, "running"),
      }),
    );

    expect(digest.header.status).toEqual({ kind: "running" });
    expect(digest.recentTurns[0]!.state).toBe("running");
  });

  it("splits the last N turns into recent detail and the rest into summaries", () => {
    const turnIds = [1, 2, 3, 4, 5].map((n) => turn(`t${n}`));
    const longReply = "done ".repeat(100);
    const file = { path: "src/a.ts", kind: "modified", additions: 3, deletions: 1 };
    const digest = digestOf(
      makeThread({
        messages: turnIds.flatMap((turnId, index) => [
          assistantMessage(`a${index}-first`, index * 10 + 1, turnId),
          assistantMessage(
            `a${index}-last`,
            index * 10 + 2,
            turnId,
            index === 0 ? longReply : `final ${index + 1}`,
          ),
        ]),
        activities: [
          activity({
            id: "tool-1",
            t: 41,
            kind: "tool.completed",
            tone: "tool",
            turnId: turnIds[4]!,
            payload: {
              itemType: "command_execution",
              status: "completed",
              detail: "vp test run turns.test.ts",
              data: { toolName: "Bash", input: {}, result: {} },
            },
          }),
          activity({
            id: "tool-2",
            t: 42,
            kind: "tool.completed",
            tone: "tool",
            turnId: turnIds[4]!,
            payload: { itemType: "file_change", status: "completed", detail: "x".repeat(400) },
          }),
          activity({
            id: "error-1",
            t: 43,
            kind: "runtime.error",
            tone: "error",
            turnId: turnIds[3]!,
            payload: { message: "provider crashed" },
          }),
        ],
        checkpoints: [checkpoint(turnIds[0]!, 1, [file]), checkpoint(turnIds[4]!, 5, [file])],
        latestTurn: latestTurn(turnIds[4]!, "completed"),
      }),
      { recentTurns: 3 },
    );

    expect(digest.earlierTurns.map((entry) => entry.n)).toEqual([1, 2]);
    expect(digest.recentTurns.map((entry) => entry.n)).toEqual([3, 4, 5]);

    const [first, second] = digest.earlierTurns;
    expect(first!.files).toEqual([file]);
    expect(byteLength(first!.outcome)).toBeLessThanOrEqual(DIGEST_LIMITS.earlierTurnBytes);
    expect(first!.outcome.startsWith("done done")).toBe(true);
    expect(second!.outcome).toBe("final 2");

    const [, fourth, fifth] = digest.recentTurns;
    expect(fourth!.state).toBe("error");
    expect(fourth!.errors).toEqual(["provider crashed"]);
    expect(fifth!.assistant).toEqual(["reply a4-first", "final 5"]);
    expect(fifth!.files).toEqual([file]);
    expect(fifth!.tools[0]).toBe("Bash completed: vp test run turns.test.ts");
    expect(fifth!.tools[1]!.startsWith("file_change completed: xxx")).toBe(true);
    expect(byteLength(fifth!.tools[1]!)).toBeLessThanOrEqual(DIGEST_LIMITS.toolDetailBytes);
  });

  it("skips reasoning messages", () => {
    const A = turn("t1");
    const digest = digestOf(
      makeThread({
        messages: [
          userMessage("u1", 1),
          reasoningMessage("r1", 2, A, "private chain of thought"),
          assistantMessage("a1", 3, A, "visible answer"),
          reasoningMessage("r2", 4, turn("t-reasoning-only")),
        ],
      }),
    );

    expect(digest.recentTurns).toHaveLength(1);
    expect(digest.recentTurns[0]!.assistant).toEqual(["visible answer"]);
  });

  it("lists only unimplemented plans and open comments", () => {
    const digest = digestOf(
      makeThread({
        proposedPlans: [plan("plan-done", at(5)), plan("plan-open", null)],
        documentComments: [comment("resolved", "resolved"), comment("open", "open")],
      }),
    );

    expect(digest.openWork.plans).toEqual([
      { id: "plan-open", excerpt: "# Plan plan-open\n\nDo the thing." },
    ]);
    expect(digest.openWork.comments).toEqual([{ file: "docs/open.md", text: "Comment open" }]);
  });

  it("takes open todos from the last plan update", () => {
    const A = turn("t1");
    const planUpdate = (
      id: string,
      t: number,
      plan: ReadonlyArray<{ step: string; status: string }>,
    ) => activity({ id, t, kind: "turn.plan.updated", turnId: A, payload: { plan } });
    const digest = digestOf(
      makeThread({
        messages: [assistantMessage("a1", 1, A)],
        activities: [
          planUpdate("p1", 2, [{ step: "Stale step", status: "pending" }]),
          planUpdate("p2", 3, [
            { step: "Write tests", status: "completed" },
            { step: "Implement digest", status: "inProgress" },
            { step: "Commit", status: "pending" },
          ]),
        ],
      }),
    );

    expect(digest.openWork.todos).toEqual(["Implement digest (inProgress)", "Commit (pending)"]);
  });

  it("marks the worktree shared when paths match", () => {
    const thread = makeThread({ worktreePath: "/work/tree-a", branch: "feature-a" });

    const shared = digestOf(thread, { callerWorktreePath: "/work/tree-a" });
    expect(shared.header).toMatchObject({
      threadId: THREAD_ID,
      branch: "feature-a",
      worktreePath: "/work/tree-a",
      worktreeRelation: "shared",
    });
    expect(digestOf(thread, { callerWorktreePath: "/work/tree-b" }).header.worktreeRelation).toBe(
      "different",
    );
    expect(
      digestOf(makeThread(), { callerWorktreePath: "/work/tree-a" }).header.worktreeRelation,
    ).toBe("none");
  });
});
