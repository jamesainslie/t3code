import { describe, expect, it } from "@effect/vitest";
import { UsageLimitSourceId, type UsageLimitSourceAccountLogin } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makeModelproxyAccountLogin } from "./modelproxyAccountLogin.ts";

const sourceId = UsageLimitSourceId.make("modelproxy-iris");
const target = { baseUrl: "https://iris.test", token: Effect.succeed("access-token") };

const pasteView = {
  sessionId: "s1",
  account: "claude-1",
  mode: "paste",
  state: "awaiting_code",
  authorizeUrl: "https://claude.com/cai/oauth/authorize?state=x",
  expiresAt: "2026-10-06T02:18:03.786209545Z",
};
const deviceView = {
  sessionId: "s2",
  account: "codex-1",
  mode: "device",
  state: "awaiting_approval",
  userCode: "ABCD-EFGH",
  verificationUrl: "https://auth.openai.com/codex/device",
  expiresAt: "2026-10-06T02:30:00Z",
};

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

/** Answers each request with the next scripted reply for its method and path. */
function fixture(replies: Record<string, Array<{ status: number; body?: unknown }>>) {
  const seen: Seen[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname;
      seen.push({ method: request.method, path, authorization: request.headers.authorization });
      const queue = replies[`${request.method} ${path}`] ?? [];
      const reply = queue.length > 1 ? queue.shift()! : (queue[0] ?? { status: 404 });
      const response =
        reply.body === undefined
          ? new Response(null, { status: reply.status })
          : Response.json(reply.body, { status: reply.status });
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  return { http, seen };
}

const make = (http: HttpClient.HttpClient) =>
  makeModelproxyAccountLogin.pipe(Effect.provideService(HttpClient.HttpClient, http));

const only = (logins: ReadonlyArray<UsageLimitSourceAccountLogin>) => {
  expect(logins).toHaveLength(1);
  return logins[0]!;
};

describe("makeModelproxyAccountLogin", () => {
  it.effect("starts a paste login with the operator's token and publishes it", () =>
    Effect.gen(function* () {
      const { http, seen } = fixture({
        "POST /api/accounts/claude-1/login": [{ status: 200, body: pasteView }],
      });
      const logins = yield* make(http);
      const result = yield* logins.run(
        sourceId,
        { sourceId, account: "claude-1", action: "start" },
        target,
      );
      expect(result.login?.authorizeUrl).toBe(pasteView.authorizeUrl);
      expect(seen[0]?.authorization).toBe("Bearer access-token");
      const published = only(yield* logins.sessions(sourceId));
      expect(published.state).toBe("awaiting_code");
      // Normalised to millisecond ISO so every client parses it alike.
      expect(published.expiresAt).toBe("2026-10-06T02:18:03.786Z");
    }),
  );

  it.effect("keeps a refused code's session open with the gateway's error code", () =>
    Effect.gen(function* () {
      const refused = { ...pasteView, errorCode: "bad_code", error: "that code did not work" };
      const { http } = fixture({
        "POST /api/accounts/claude-1/login": [{ status: 200, body: pasteView }],
        "POST /api/accounts/claude-1/login/s1/code": [
          { status: 400, body: { error: "that code did not work", session: refused } },
        ],
      });
      const logins = yield* make(http);
      yield* logins.run(sourceId, { sourceId, account: "claude-1", action: "start" }, target);
      const result = yield* logins.run(
        sourceId,
        { sourceId, account: "claude-1", action: "submit", code: "nope" },
        target,
      );
      expect(result.login?.state).toBe("awaiting_code");
      expect(result.login?.errorCode).toBe("bad_code");
    }),
  );

  it.effect("polls a device login until the gateway reports it finished", () =>
    Effect.gen(function* () {
      const { http, seen } = fixture({
        "POST /api/accounts/codex-1/login": [{ status: 200, body: deviceView }],
        "GET /api/accounts/codex-1/login/s2": [
          { status: 200, body: deviceView },
          { status: 200, body: { ...deviceView, state: "completed" } },
        ],
      });
      const logins = yield* make(http);
      yield* logins.run(sourceId, { sourceId, account: "codex-1", action: "start" }, target);
      yield* TestClock.adjust("3 seconds");
      expect(only(yield* logins.sessions(sourceId)).state).toBe("awaiting_approval");
      yield* TestClock.adjust("3 seconds");
      expect(only(yield* logins.sessions(sourceId)).state).toBe("completed");
      const reads = seen.filter((request) => request.method === "GET").length;
      yield* TestClock.adjust("30 seconds");
      expect(seen.filter((request) => request.method === "GET")).toHaveLength(reads);
    }),
  );

  it.effect("drops a finished login from the snapshot after a minute", () =>
    Effect.gen(function* () {
      const done = { ...pasteView, state: "completed" };
      const { http } = fixture({
        "POST /api/accounts/claude-1/login": [{ status: 200, body: pasteView }],
        "POST /api/accounts/claude-1/login/s1/code": [{ status: 200, body: done }],
      });
      const logins = yield* make(http);
      yield* logins.run(sourceId, { sourceId, account: "claude-1", action: "start" }, target);
      yield* logins.run(
        sourceId,
        { sourceId, account: "claude-1", action: "submit", code: "good" },
        target,
      );
      expect(only(yield* logins.sessions(sourceId)).state).toBe("completed");
      yield* TestClock.adjust("61 seconds");
      expect(yield* logins.sessions(sourceId)).toHaveLength(0);
    }),
  );

  it.effect("cancels on the gateway and forgets the login", () =>
    Effect.gen(function* () {
      const { http, seen } = fixture({
        "POST /api/accounts/claude-1/login": [{ status: 200, body: pasteView }],
        "DELETE /api/accounts/claude-1/login/s1": [{ status: 204 }],
      });
      const logins = yield* make(http);
      yield* logins.run(sourceId, { sourceId, account: "claude-1", action: "start" }, target);
      const result = yield* logins.run(
        sourceId,
        { sourceId, account: "claude-1", action: "cancel" },
        target,
      );
      expect(result.login).toBe(undefined);
      expect(seen.some((request) => request.method === "DELETE")).toBe(true);
      expect(yield* logins.sessions(sourceId)).toHaveLength(0);
    }),
  );

  it.effect("explains a gateway too old to log accounts in", () =>
    Effect.gen(function* () {
      const { http } = fixture({});
      const logins = yield* make(http);
      const exit = yield* logins
        .run(sourceId, { sourceId, account: "claude-1", action: "start" }, target)
        .pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("does not support");
    }),
  );
});
