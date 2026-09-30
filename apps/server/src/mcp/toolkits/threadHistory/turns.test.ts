import { describe, expect, it } from "@effect/vitest";

import {
  activity,
  assistantMessage,
  checkpoint,
  latestTurn,
  makeThread,
  reasoningMessage,
  turn,
  userMessage,
} from "./testFixtures.ts";
import { reconstructTurns } from "./turns.ts";

const A = turn("turn-a");
const B = turn("turn-b");
const C = turn("turn-c");

const messageIds = (messages: ReadonlyArray<{ readonly id: string }>) =>
  messages.map((message) => message.id);

describe("reconstructTurns", () => {
  it("attaches a user message to the turn that follows it", () => {
    const turns = reconstructTurns(
      makeThread({ messages: [userMessage("u1", 1), assistantMessage("a1", 2, A)] }),
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ n: 1, turnId: A, state: "completed" });
    expect(messageIds(turns[0]!.userMessages)).toEqual(["u1"]);
    expect(messageIds(turns[0]!.assistantMessages)).toEqual(["a1"]);
  });

  it("keeps assistant-only turns as their own turns", () => {
    const turns = reconstructTurns(
      makeThread({ messages: [assistantMessage("a1", 1, A), assistantMessage("a2", 2, B)] }),
    );

    expect(turns.map((entry) => entry.turnId)).toEqual([A, B]);
    expect(turns.map((entry) => entry.userMessages)).toEqual([[], []]);
    expect(messageIds(turns[1]!.assistantMessages)).toEqual(["a2"]);
  });

  it("keeps a trailing user message as a queued turn", () => {
    const messages = [userMessage("u1", 1), assistantMessage("a1", 2, A), userMessage("u2", 3)];

    const queued = reconstructTurns(
      makeThread({ messages, latestTurn: latestTurn(A, "completed") }),
    );
    expect(queued).toHaveLength(2);
    expect(queued[1]).toMatchObject({ n: 2, turnId: null, state: "queued" });
    expect(messageIds(queued[1]!.userMessages)).toEqual(["u2"]);
    expect(queued[1]!.assistantMessages).toEqual([]);

    // The provider has started the turn but has not answered yet.
    const started = reconstructTurns(
      makeThread({
        messages,
        latestTurn: latestTurn(B, "running"),
        activities: [activity({ id: "e1", t: 4, kind: "tool.started", turnId: B, tone: "tool" })],
      }),
    );
    expect(started[1]).toMatchObject({ n: 2, turnId: B, state: "running" });
    expect(started[1]!.activities.map((entry) => entry.id)).toEqual(["e1"]);
  });

  it("takes the latest turn's state and marks earlier turns with a runtime.error as error", () => {
    const failure = activity({
      id: "e-error",
      t: 2,
      kind: "runtime.error",
      tone: "error",
      turnId: A,
      payload: { message: "provider crashed" },
    });
    const turns = reconstructTurns(
      makeThread({
        messages: [
          assistantMessage("a1", 1, A),
          assistantMessage("a2", 3, B),
          assistantMessage("a3", 5, C),
          assistantMessage("a4", 7, turn("turn-d")),
        ],
        activities: [
          failure,
          activity({
            id: "e-start",
            t: 4,
            kind: "provider.turn.start.failed",
            tone: "error",
            turnId: B,
          }),
          // Error-tone activities that are not turn failures leave the state alone.
          activity({ id: "e-denied", t: 6, kind: "tool.denied", tone: "error", turnId: C }),
        ],
        checkpoints: [checkpoint(A, 1), checkpoint(C, 3)],
        latestTurn: latestTurn(turn("turn-d"), "interrupted"),
      }),
    );

    expect(turns.map((entry) => entry.state)).toEqual([
      "error",
      "error",
      "completed",
      "interrupted",
    ]);
    expect(turns[0]!.activities).toEqual([failure]);
    expect(turns[0]!.checkpoint?.checkpointTurnCount).toBe(1);
    expect(turns[1]!.checkpoint).toBeNull();

    // The latest turn's recorded state wins over its own error activities.
    const recovered = reconstructTurns(
      makeThread({
        messages: [assistantMessage("a1", 1, A)],
        activities: [failure],
        latestTurn: latestTurn(A, "completed"),
      }),
    );
    expect(recovered[0]!.state).toBe("completed");
  });

  it("appends an unseen errored or interrupted latest turn as its own turn", () => {
    const D = turn("turn-d");
    const failure = activity({
      id: "e-d",
      t: 3,
      kind: "runtime.error",
      tone: "error",
      turnId: D,
      payload: { message: "provider crashed before replying" },
    });
    const turns = reconstructTurns(
      makeThread({
        messages: [userMessage("u1", 1), assistantMessage("a1", 2, A)],
        activities: [failure],
        latestTurn: latestTurn(D, "error"),
      }),
    );

    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ n: 2, turnId: D, state: "error" });
    expect(turns[1]!.userMessages).toEqual([]);
    expect(turns[1]!.assistantMessages).toEqual([]);
    expect(turns[1]!.activities).toEqual([failure]);

    const interrupted = reconstructTurns(
      makeThread({
        messages: [assistantMessage("a1", 1, A)],
        latestTurn: latestTurn(D, "interrupted"),
      }),
    );
    expect(interrupted.map((entry) => [entry.turnId, entry.state])).toEqual([
      [A, "completed"],
      [D, "interrupted"],
    ]);

    // A running turn with no messages yet is left to the header status.
    const running = reconstructTurns(
      makeThread({
        messages: [assistantMessage("a1", 1, A)],
        latestTurn: latestTurn(D, "running"),
      }),
    );
    expect(running).toHaveLength(1);
  });

  it("numbers turns from 1 in message order", () => {
    const turns = reconstructTurns(
      makeThread({
        // Stored out of order; reasoning never opens a turn of its own.
        messages: [
          assistantMessage("a3", 6, C),
          userMessage("u1", 1),
          reasoningMessage("r0", 0, turn("turn-thinking-only")),
          assistantMessage("a1", 2, A),
          reasoningMessage("r2", 4, B),
          userMessage("u2", 3),
          assistantMessage("a2", 5, B),
        ],
      }),
    );

    expect(turns.map((entry) => [entry.n, entry.turnId])).toEqual([
      [1, A],
      [2, B],
      [3, C],
    ]);
    expect(messageIds(turns[1]!.userMessages)).toEqual(["u2"]);
    expect(messageIds(turns[1]!.assistantMessages)).toEqual(["a2"]);
  });
});
