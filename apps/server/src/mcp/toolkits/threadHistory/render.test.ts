import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  DIGEST_LIMITS,
  type DigestTurnDetail,
  type DigestTurnSummary,
  type ThreadDigest,
} from "./digest.ts";
import {
  escapeBody,
  renderThreadDigest,
  renderThreadMatches,
  renderTurnDetails,
} from "./render.ts";
import { THREAD_ID } from "./testFixtures.ts";
import { cutToBytes } from "./text.ts";

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

const file = (path: string, additions = 3, deletions = 1) => ({
  path,
  kind: "modified",
  additions,
  deletions,
});

const summary = (n: number, overrides: Partial<DigestTurnSummary> = {}): DigestTurnSummary => ({
  n,
  state: "completed",
  outcome: `Finished step ${n}.`,
  files: [],
  ...overrides,
});

const detail = (n: number, overrides: Partial<DigestTurnDetail> = {}): DigestTurnDetail => ({
  n,
  state: "completed",
  user: `Please do step ${n}.`,
  assistant: [`Done with step ${n}.`],
  tools: [],
  files: [],
  errors: [],
  ...overrides,
});

// A detailed turn whose bodies are as large as the digest ever makes them.
const largeDetail = (n: number, overrides: Partial<DigestTurnDetail> = {}) =>
  detail(n, {
    user: cutToBytes(`Turn ${n} request. ${"please ".repeat(200)}`, DIGEST_LIMITS.steeringBytes),
    assistant: Array.from({ length: 6 }, (_, index) =>
      cutToBytes(`Turn ${n} reply ${index}. ${"working ".repeat(80)}`, DIGEST_LIMITS.excerptBytes),
    ),
    tools: Array.from({ length: 8 }, (_, index) =>
      cutToBytes(
        `Bash completed: vp test ${index} ${"x".repeat(400)}`,
        DIGEST_LIMITS.toolDetailBytes,
      ),
    ),
    files: [file(`src/turn-${n}.ts`, 12, 3)],
    ...overrides,
  });

// A detailed turn that fits a small budget alone, but not beside two more like it.
const mediumDetail = (n: number, overrides: Partial<DigestTurnDetail> = {}) =>
  detail(n, {
    user: cutToBytes(`Turn ${n} request. ${"please ".repeat(40)}`, 200),
    assistant: [0, 1].map((index) =>
      cutToBytes(`Turn ${n} reply ${index}. ${"working ".repeat(80)}`, DIGEST_LIMITS.excerptBytes),
    ),
    tools: [`Bash completed: vp test`],
    files: [file(`src/turn-${n}.ts`, 12, 3)],
    ...overrides,
  });

function makeDigest(overrides: Partial<ThreadDigest> = {}): ThreadDigest {
  return {
    header: {
      threadId: THREAD_ID,
      title: "Thread history fixture",
      projectTitle: "Project",
      provider: "codex",
      model: "gpt-5",
      branch: "main",
      worktreePath: null,
      worktreeRelation: "none",
      createdAt: "2026-09-01T00:00:00.000Z",
      lastActivityAt: "2026-09-01T01:00:00.000Z",
      status: { kind: "completed" },
    },
    goal: "Build the thing.",
    steering: [],
    openWork: { todos: [], plans: [], comments: [], pullRequests: [] },
    earlierTurns: [],
    recentTurns: [],
    ...overrides,
  };
}

const recentTurnsSection = (text: string) =>
  text.slice(text.indexOf("<recent_turns>"), text.indexOf("</recent_turns>"));

describe("escapeBody", () => {
  it("escapeBody neutralizes closing tags", () => {
    const escaped = escapeBody("a </user> b </thread>");
    expect(escaped).not.toContain("</user>");
    expect(escaped).not.toContain("</thread>");
    expect(escaped).toBe("a <\\/user> b <\\/thread>");
  });

  it("leaves closing tags that are not digest elements readable", () => {
    expect(escapeBody("<div>x</div> </Turn > </usernames>")).toBe(
      "<div>x</div> <\\/Turn > </usernames>",
    );
  });

  it("keeps a message body from closing its enclosing element", () => {
    const text = renderThreadDigest(
      makeDigest({
        goal: "goal </goal></thread>",
        recentTurns: [detail(1, { user: "look </user></turn>", assistant: ["ok </assistant>"] })],
      }),
    );
    expect(text.match(/<\/thread>/g)).toHaveLength(1);
    expect(text.match(/<\/goal>/g)).toHaveLength(1);
    expect(text.match(/<\/user>/g)).toHaveLength(1);
    expect(text.match(/<\/assistant>/g)).toHaveLength(1);
    expect(text.match(/<\/turn>/g)).toHaveLength(1);
  });
});

describe("renderThreadDigest", () => {
  it("escapes attribute values", () => {
    const text = renderThreadDigest(
      makeDigest({
        header: { ...makeDigest().header, title: `Fix "quotes" & <tags>` },
      }),
    );
    expect(text).toContain(`title="Fix &quot;quotes&quot; &amp; &lt;tags>"`);
  });

  it("reports the thread status with its details", () => {
    const withStatus = (status: ThreadDigest["header"]["status"]) =>
      renderThreadDigest(makeDigest({ header: { ...makeDigest().header, status } })).split("\n")[0];
    expect(withStatus({ kind: "error", message: `Rate "limited"` })).toContain(
      `status="error" error="Rate &quot;limited&quot;"`,
    );
    expect(withStatus({ kind: "context-full", usedTokens: 190_000, maxTokens: 200_000 })).toContain(
      `status="context-full" used_tokens="190000" max_tokens="200000"`,
    );
    expect(withStatus({ kind: "empty" })).toContain(`status="empty"`);
  });

  it("keeps the newest recent turn when the budget is tiny", () => {
    const digest = makeDigest({
      earlierTurns: Array.from({ length: 20 }, (_, index) =>
        summary(index + 1, { outcome: cutToBytes("outcome ".repeat(40), 150) }),
      ),
      recentTurns: [mediumDetail(21), mediumDetail(22), mediumDetail(23)],
    });
    const text = renderThreadDigest(digest, 2_000);
    const recent = recentTurnsSection(text);

    expect(byteLength(text)).toBeLessThanOrEqual(2_000);
    expect(recent).toMatch(/<turn n="21" state="completed" files="[^"]*" summary="true">/);
    expect(recent).toMatch(/<turn n="22" state="completed" files="[^"]*" summary="true">/);
    expect(recent).toContain(`<turn n="23" state="completed">\n<user>Turn 23 request.`);
    expect(recent).toContain("<assistant>Turn 23 reply 1.");
    expect(text).toMatch(/<more before_turn="\d+" omitted_turns="\d+"\/>/);
  });

  it("degrades a recent turn to its last assistant message", () => {
    const digest = makeDigest({
      recentTurns: [
        mediumDetail(1, { assistant: ["first reply", "final reply ".repeat(30)] }),
        mediumDetail(2),
      ],
    });
    const text = renderThreadDigest(digest, 1_800);
    const line = text.split("\n").find((entry) => entry.startsWith(`<turn n="1"`));

    expect(line).toBe(
      `<turn n="1" state="completed" files="src/turn-1.ts +12 -3" summary="true">${cutToBytes(
        "final reply ".repeat(30),
        DIGEST_LIMITS.earlierTurnBytes,
      )}</turn>`,
    );
  });

  it("fills earlier turns newest first and reports how many were omitted", () => {
    const earlierTurns = Array.from({ length: 40 }, (_, index) =>
      summary(index + 1, { outcome: cutToBytes(`Turn ${index + 1} ${"did ".repeat(60)}`, 150) }),
    );
    const digest = makeDigest({ earlierTurns, recentTurns: [detail(41)] });
    const text = renderThreadDigest(digest, 3_000);

    const rendered = [...text.matchAll(/<turn n="(\d+)"/g)].map((match) => Number(match[1]));
    const earlier = rendered.slice(0, -1);
    expect(rendered.at(-1)).toBe(41);
    expect(earlier.length).toBeGreaterThan(0);
    expect(earlier.length).toBeLessThan(40);
    // A contiguous run ending at the newest earlier turn, emitted oldest first.
    const oldest = earlier[0]!;
    expect(earlier).toEqual(Array.from({ length: 40 - oldest + 1 }, (_, index) => oldest + index));
    expect(text).toContain(`<more before_turn="${oldest}" omitted_turns="${oldest - 1}"/>`);
    expect(text).toContain(
      "read_thread_turns(threadId, beforeTurn) returns earlier turns in full.",
    );
    expect(byteLength(text)).toBeLessThanOrEqual(3_000);
  });

  it("omits the more marker when every turn fits", () => {
    const text = renderThreadDigest(
      makeDigest({ earlierTurns: [summary(1)], recentTurns: [detail(2)] }),
    );
    expect(text).not.toContain("<more");
    expect(text).toContain(`<turn n="1" state="completed">Finished step 1.</turn>`);
  });

  it("drops the oldest steering messages first when fixed sections overflow", () => {
    const steering = Array.from({ length: 300 }, (_, index) => ({
      turn: index + 2,
      text: cutToBytes(`Steer ${index + 2} ${"adjust ".repeat(100)}`, DIGEST_LIMITS.steeringBytes),
    }));
    const text = renderThreadDigest(
      makeDigest({ steering, recentTurns: [detail(302)] }),
      DIGEST_LIMITS.budgetBytes,
    );
    const turns = [...text.matchAll(/<user turn="(\d+)">/g)].map((match) => Number(match[1]));

    expect(byteLength(text)).toBeLessThanOrEqual(DIGEST_LIMITS.budgetBytes);
    expect(text).toContain("<goal>Build the thing.</goal>");
    expect(turns.at(-1)).toBe(301);
    expect(text).toContain(`<steering omitted="${turns[0]! - 2}">`);
    expect(text).toContain(`<turn n="302" state="completed">`);
  });

  it("cuts the newest turn's assistant text but keeps its user text and files", () => {
    const newest = largeDetail(1, {
      assistant: Array.from({ length: 200 }, (_, index) =>
        cutToBytes(`reply ${index} ${"long ".repeat(100)}`, DIGEST_LIMITS.excerptBytes),
      ),
      files: [file("src/a.ts", 12, 3), file("src/b.ts", 1, 0)],
    });
    const text = renderThreadDigest(makeDigest({ recentTurns: [newest] }), 4_000);

    expect(byteLength(text)).toBeLessThanOrEqual(4_000);
    expect(text).toContain(`<user>${newest.user}</user>`);
    expect(text).toContain("<files>src/a.ts +12 -3, src/b.ts +1 -0</files>");
    expect(text).toMatch(/<assistant omitted="\d+"\/>/);
    expect(text).toContain("<assistant>reply 199 ");
    expect(text).not.toContain("<assistant>reply 0 ");
  });

  it("stays within the budget", () => {
    const longTurns = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        summary(index + 1, {
          outcome: cutToBytes(`Outcome ${index + 1} ${"🙂 ".repeat(80)}`, 150),
          files: Array.from({ length: 40 }, (__, fileIndex) =>
            file(`src/module-${index}/file-${fileIndex}.ts`),
          ),
        }),
      );
    const longSteering = Array.from({ length: 400 }, (_, index) => ({
      turn: index + 2,
      text: cutToBytes(`</user> ${"steer ".repeat(100)}`, DIGEST_LIMITS.steeringBytes),
    }));
    const manyOpen = {
      todos: Array.from({ length: 100 }, (_, index) =>
        cutToBytes(`Todo ${index} ${"t".repeat(400)}`, 300),
      ),
      plans: Array.from({ length: 100 }, (_, index) => ({
        id: `plan-${index}`,
        excerpt: "p".repeat(300),
      })),
      comments: Array.from({ length: 100 }, (_, index) => ({
        file: `docs/${index}.md`,
        text: "c".repeat(300),
      })),
      pullRequests: Array.from({ length: 100 }, (_, index) => ({
        number: index,
        state: "open",
        url: `https://github.com/o/r/pull/${index}`,
      })),
    };
    const hugeNewest = largeDetail(250, {
      assistant: Array.from({ length: 300 }, () => "a".repeat(300)),
      tools: Array.from({ length: 300 }, () => "t".repeat(300)),
      errors: Array.from({ length: 300 }, () => "e".repeat(300)),
      files: Array.from({ length: 500 }, (_, index) => file(`src/generated/file-${index}.ts`)),
    });

    const fixtures = [
      makeDigest({
        steering: longSteering.slice(0, 44),
        earlierTurns: longTurns(247),
        recentTurns: [largeDetail(248), largeDetail(249), largeDetail(250)],
      }),
      makeDigest({
        goal: "g".repeat(DIGEST_LIMITS.goalBytes),
        steering: longSteering,
        openWork: manyOpen,
        earlierTurns: longTurns(247),
        recentTurns: [largeDetail(248), largeDetail(249), hugeNewest],
      }),
      makeDigest({ earlierTurns: longTurns(250), recentTurns: [] }),
    ];

    for (const budgetBytes of [DIGEST_LIMITS.budgetBytes, 8_000, 2_000]) {
      for (const digest of fixtures) {
        const text = renderThreadDigest(digest, budgetBytes);
        expect(byteLength(text)).toBeLessThanOrEqual(budgetBytes);
        expect(text.startsWith(`<thread id="${THREAD_ID}"`)).toBe(true);
        expect(text.endsWith("</thread>")).toBe(true);
        const newest = digest.recentTurns.at(-1);
        if (newest) expect(text).toContain(`<turn n="${newest.n}" state="${newest.state}">`);
      }
    }
  });

  it("renders the golden digest", () => {
    const fixture = makeDigest({
      header: {
        threadId: THREAD_ID,
        title: "Migrate the scheduler",
        projectTitle: "t3code",
        provider: "claudeAgent",
        model: "claude-opus-4",
        branch: "scheduler-migration",
        worktreePath: "/work/t3code/.worktrees/scheduler",
        worktreeRelation: "shared",
        createdAt: "2026-09-01T00:00:00.000Z",
        lastActivityAt: "2026-09-01T02:30:00.000Z",
        status: { kind: "interrupted" },
      },
      goal: "Move the job scheduler onto the queue-backed reactor.\n\nKeep the public API stable.",
      steering: [
        { turn: 2, text: "Use the existing receipt types." },
        { turn: 4, text: "Skip the retry rewrite for now." },
      ],
      openWork: {
        todos: ["Port the cron parser (in_progress)", "Delete the old worker (pending)"],
        plans: [{ id: "plan-1", excerpt: "# Scheduler plan\n\n1. Port parser\n2. Swap worker" }],
        comments: [{ file: "docs/scheduler.md", text: "This section is out of date." }],
        pullRequests: [{ number: 42, state: "open", url: "https://github.com/o/r/pull/42" }],
      },
      earlierTurns: [
        summary(1, { outcome: "Mapped the scheduler call sites.", files: [] }),
        summary(2, {
          outcome: "Added the queue reactor skeleton.",
          files: [file("src/reactor.ts", 40, 0), file("src/index.ts", 2, 1)],
        }),
      ],
      recentTurns: [
        detail(3, {
          user: "",
          assistant: ["Background check finished."],
        }),
        detail(4, {
          state: "interrupted",
          user: "Skip the retry rewrite for now.",
          assistant: ["Understood, leaving retries alone.", "Ported the parser; tests pass."],
          tools: ["Edit completed: src/cron.ts", `Bash failed: vp test "cron"`],
          files: [file("src/cron.ts", 12, 3)],
          errors: ["Turn interrupted by the user"],
        }),
      ],
    });
    expect(renderThreadDigest(fixture)).toMatchSnapshot();
  });

  it("renders the golden digest under a tight budget", () => {
    const fixture = makeDigest({
      steering: Array.from({ length: 8 }, (_, index) => ({
        turn: index + 2,
        text: `Steer ${index + 2}: ${"adjust the plan ".repeat(8)}`,
      })),
      earlierTurns: Array.from({ length: 8 }, (_, index) =>
        summary(index + 1, { files: [file(`src/step-${index + 1}.ts`)] }),
      ),
      recentTurns: [mediumDetail(9), mediumDetail(10)],
    });
    expect(renderThreadDigest(fixture, 1_800)).toMatchSnapshot();
  });
});

describe("renderTurnDetails", () => {
  it("renders turns in full with a marker for older turns", () => {
    const text = renderTurnDetails(THREAD_ID, [detail(4), detail(5)], 3);
    expect(text.startsWith(`<thread id="${THREAD_ID}">`)).toBe(true);
    expect(text).toContain(`<turn n="4" state="completed">\n<user>Please do step 4.</user>`);
    expect(text).toContain(`<more before_turn="4" omitted_turns="3"/>`);
    expect(text.endsWith("</thread>")).toBe(true);
  });

  it("drops the oldest turns that do not fit the budget and counts them as older", () => {
    const turns = Array.from({ length: 10 }, (_, index) =>
      largeDetail(index + 11, {
        assistant: Array.from({ length: 20 }, () => "a".repeat(300)),
      }),
    );
    const text = renderTurnDetails(THREAD_ID, turns, 10);
    const rendered = [...text.matchAll(/<turn n="(\d+)"/g)].map((match) => Number(match[1]));

    expect(byteLength(text)).toBeLessThanOrEqual(DIGEST_LIMITS.budgetBytes);
    expect(rendered.at(-1)).toBe(20);
    expect(rendered.length).toBeLessThan(10);
    expect(text).toContain(
      `<more before_turn="${rendered[0]}" omitted_turns="${10 + 10 - rendered.length}"/>`,
    );
  });
});

describe("renderThreadMatches", () => {
  it("renders one line per thread", () => {
    const text = renderThreadMatches([
      {
        threadId: ThreadId.make("thread-a"),
        title: `Fix "login"`,
        projectTitle: "web",
        branch: "fix-login",
        lastActivityAt: "2026-09-01T00:00:00.000Z",
        status: "completed",
      },
      {
        threadId: ThreadId.make("thread-b"),
        title: "Untitled",
        projectTitle: null,
        branch: null,
        lastActivityAt: "2026-09-02T00:00:00.000Z",
        status: "running",
      },
    ]);
    expect(text.split("\n")).toEqual([
      `<thread id="thread-a" title="Fix &quot;login&quot;" project="web" branch="fix-login" last_activity="2026-09-01T00:00:00.000Z" status="completed"/>`,
      `<thread id="thread-b" title="Untitled" last_activity="2026-09-02T00:00:00.000Z" status="running"/>`,
    ]);
  });

  it("says so when nothing matched", () => {
    expect(renderThreadMatches([])).toBe("No threads matched.");
  });
});
