import { describe, expect, it } from "@effect/vitest";

import {
  assistantMessage,
  checkpoint,
  commandItem,
  file,
  makeThread,
  run,
  runId,
  userMessage,
} from "./testFixtures.ts";
import { reconstructTurns, runState } from "./turns.ts";

const A = runId("run-a");
const B = runId("run-b");
const C = runId("run-c");

const messageIds = (messages: ReadonlyArray<{ readonly id: string }>) =>
  messages.map((message) => message.id);

describe("reconstructTurns", () => {
  it("makes each run a turn with its prompt, replies, items and files", () => {
    const turns = reconstructTurns(
      makeThread({
        runs: [run({ id: A, ordinal: 1, userMessageId: "u1" })],
        messages: [userMessage("u1", 1), assistantMessage("a1", 2, A)],
        turnItems: [commandItem("cmd", 3, A, "vp test")],
        checkpoints: [checkpoint(A, 1, [file("src/a.ts")])],
      }),
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ n: 1, runId: A, state: "completed" });
    expect(messageIds(turns[0]!.userMessages)).toEqual(["u1"]);
    expect(messageIds(turns[0]!.assistantMessages)).toEqual(["a1"]);
    expect(turns[0]!.items.map((item) => item.id)).toEqual(["cmd"]);
    expect(turns[0]!.files.map((entry) => entry.path)).toEqual(["src/a.ts"]);
  });

  it("orders runs by ordinal and joins a steering message to the run it steered", () => {
    const turns = reconstructTurns(
      makeThread({
        // Stored out of order.
        runs: [
          run({ id: B, ordinal: 2, userMessageId: "u2" }),
          run({ id: A, ordinal: 1, userMessageId: "u1" }),
        ],
        messages: [
          userMessage("u2", 300),
          userMessage("u1", 100),
          userMessage("steer", 150, "go faster", A),
          assistantMessage("a1", 160, A),
          assistantMessage("a2", 310, B),
        ],
      }),
    );

    expect(turns.map((entry) => [entry.n, entry.runId])).toEqual([
      [1, A],
      [2, B],
    ]);
    expect(messageIds(turns[0]!.userMessages)).toEqual(["u1", "steer"]);
    expect(messageIds(turns[1]!.assistantMessages)).toEqual(["a2"]);
  });

  it("leaves out undone runs and queued runs cancelled before they started", () => {
    const turns = reconstructTurns(
      makeThread({
        runs: [
          run({ id: A, ordinal: 1, userMessageId: "u1" }),
          run({ id: B, ordinal: 2, userMessageId: "u2", status: "rolled_back" }),
          {
            ...run({ id: C, ordinal: 3, userMessageId: "u3", status: "cancelled" }),
            startedAt: null,
          },
        ],
        messages: [userMessage("u1", 1), userMessage("u2", 200), userMessage("u3", 300)],
      }),
    );

    expect(turns.map((entry) => entry.runId)).toEqual([A]);
  });

  it("groups a v1 thread's imported messages into turns before any v2 run", () => {
    const turns = reconstructTurns(
      makeThread({
        runs: [run({ id: A, ordinal: 1, userMessageId: "u-new", t: 500 })],
        messages: [
          userMessage("old-u1", 1),
          userMessage("old-u1b", 2),
          { ...assistantMessage("old-a1", 3, A), runId: null },
          userMessage("old-u2", 4),
          { ...assistantMessage("old-a2", 5, A), runId: null },
          userMessage("u-new", 500),
          assistantMessage("a-new", 501, A),
        ],
      }),
    );

    expect(turns.map((entry) => [entry.n, entry.runId, messageIds(entry.userMessages)])).toEqual([
      [1, null, ["old-u1", "old-u1b"]],
      [2, null, ["old-u2"]],
      [3, A, ["u-new"]],
    ]);
    expect(messageIds(turns[0]!.assistantMessages)).toEqual(["old-a1"]);
  });
});

describe("runState", () => {
  it("reads a run's status as a digest state", () => {
    expect(
      (
        ["queued", "running", "waiting", "completed", "interrupted", "cancelled", "failed"] as const
      ).map((status) => runState({ status })),
    ).toEqual(["queued", "running", "running", "completed", "interrupted", "interrupted", "error"]);
  });
});
