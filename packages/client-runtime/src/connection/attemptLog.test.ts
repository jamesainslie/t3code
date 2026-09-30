import { describe, expect, it } from "@effect/vitest";

import { attemptLogToText, describeAttemptLogEntry } from "./attemptLog.ts";
import { ConnectionBlockedError, ConnectionTransientError } from "./model.ts";

const AT = Date.parse("2026-09-30T12:00:00.000Z");

describe("describeAttemptLogEntry", () => {
  it("names each step of an attempt", () => {
    expect(describeAttemptLogEntry({ at: AT, attempt: 2, kind: "started" })).toEqual({
      text: "Attempt 2",
      tone: "muted",
    });
    expect(
      describeAttemptLogEntry({ at: AT, attempt: 2, kind: "stage", stage: "opening" }).text,
    ).toBe("Opening the connection");
    expect(describeAttemptLogEntry({ at: AT, attempt: 2, kind: "connected" })).toEqual({
      text: "Connected",
      tone: "success",
    });
    expect(
      describeAttemptLogEntry({ at: AT, attempt: 2, kind: "retrying", retryAt: AT + 4_000 }).text,
    ).toBe("Retrying in 4s");
    expect(
      describeAttemptLogEntry({ at: AT, attempt: 2, kind: "retrying", retryAt: AT }).text,
    ).toBe("Retrying now");
  });

  it("spells out a failure's reason, socket close, and trace", () => {
    expect(
      describeAttemptLogEntry({
        at: AT,
        attempt: 1,
        kind: "failed",
        error: new ConnectionTransientError({
          reason: "transport",
          detail: "devbox disconnected.",
          traceId: "abc123",
          socketClose: { code: 1006, wasClean: false },
        }),
      }),
    ).toEqual({
      text: "Failed (transport): devbox disconnected. Socket closed with code 1006, not cleanly. Trace abc123.",
      tone: "warning",
    });
    expect(
      describeAttemptLogEntry({
        at: AT,
        attempt: 1,
        kind: "failed",
        error: new ConnectionBlockedError({
          reason: "authentication",
          detail: "Sign in again.",
        }),
      }),
    ).toEqual({ text: "Blocked (authentication): Sign in again.", tone: "error" });
  });
});

describe("attemptLogToText", () => {
  it("writes the attempts and then the SSH output, one timestamped line each", () => {
    expect(
      attemptLogToText(
        [
          { at: AT, attempt: 1, kind: "started" },
          { at: AT + 1_000, attempt: 1, kind: "connected" },
        ],
        [
          {
            at: "2026-09-30T11:59:59.500Z",
            source: "launch",
            stderr: true,
            text: "installing t3",
          },
        ],
      ),
    ).toBe(
      [
        "2026-09-30T12:00:00.000Z Attempt 1",
        "2026-09-30T12:00:01.000Z Connected",
        "",
        "SSH output",
        "2026-09-30T11:59:59.500Z [launch stderr] installing t3",
      ].join("\n"),
    );
    expect(attemptLogToText([{ at: AT, attempt: 1, kind: "offline" }])).toBe(
      "2026-09-30T12:00:00.000Z Waiting for the network",
    );
  });
});
