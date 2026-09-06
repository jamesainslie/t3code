import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as TestClock from "effect/testing/TestClock";

import { AuthRelayError } from "../auth-relay/AuthRelayError.ts";
import { readAuthorizationRequestCallback } from "../auth-relay/loopbackCallback.ts";
import { makeTerminalBrowserLaunches } from "./browserLaunches.ts";

const terminal = { threadId: "thread-1", terminalId: "term-1" };
const authorizeUrl =
  "https://auth.example.com/authorize?client_id=x&redirect_uri=http%3A%2F%2F127.0.0.1%3A46353%2Fcallback&state=opaque-state";
const deviceUrl = "https://github.com/login/device";

it("reads the loopback target and state only when the URL advertises a loopback listener", () => {
  assert.deepEqual(readAuthorizationRequestCallback(new URL(authorizeUrl)), {
    redirectUri: "http://127.0.0.1:46353/callback",
    state: "opaque-state",
  });
  assert.deepEqual(readAuthorizationRequestCallback(new URL(deviceUrl)), {
    redirectUri: null,
    state: null,
  });
  assert.deepEqual(
    readAuthorizationRequestCallback(
      new URL(
        "https://auth.example.com/authorize?redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&state=s",
      ),
    ),
    { redirectUri: null, state: null },
  );
});

it.layer(NodeServices.layer)("terminal browser launches", (it) => {
  const makeHarness = Effect.fn("makeHarness")(function* (
    options: { readonly fail?: boolean } = {},
  ) {
    const forwarded: string[] = [];
    const launches = yield* makeTerminalBrowserLaunches({
      forward: (callback) =>
        options.fail
          ? Effect.fail(new AuthRelayError({ operation: "complete", detail: "refused" }))
          : Effect.sync(() => void forwarded.push(callback.href)),
    });
    return { launches, forwarded };
  });

  it.effect("replays an owned callback once and refuses a second delivery", () =>
    Effect.gen(function* () {
      const { launches, forwarded } = yield* makeHarness();
      const capture = yield* launches.capture(terminal, authorizeUrl);
      assert.isNotNull(capture);
      assert.equal(capture!.redirectUri, "http://127.0.0.1:46353/callback");
      assert.deepEqual(launches.pending(terminal), [capture!]);

      const callbackUrl = "http://127.0.0.1:46353/callback?code=abc&state=opaque-state";
      yield* launches.complete({ ...terminal, captureId: capture!.captureId, callbackUrl });
      assert.deepEqual(forwarded, [callbackUrl]);
      assert.deepEqual(launches.pending(terminal), []);

      const again = yield* launches
        .complete({ ...terminal, captureId: capture!.captureId, callbackUrl })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(again));
      assert.deepEqual(forwarded, [callbackUrl]);
    }),
  );

  it.effect("requires the advertised listener and state", () =>
    Effect.gen(function* () {
      const { launches, forwarded } = yield* makeHarness();
      const capture = yield* launches.capture(terminal, authorizeUrl);
      for (const callbackUrl of [
        "http://127.0.0.1:46354/callback?code=abc&state=opaque-state",
        "http://localhost:46353/callback?code=abc&state=opaque-state",
        "http://127.0.0.1:46353/other?code=abc&state=opaque-state",
        "http://127.0.0.1:46353/callback?code=abc&state=wrong",
        "http://127.0.0.1:46353/callback?code=abc",
      ]) {
        const result = yield* launches
          .complete({ ...terminal, captureId: capture!.captureId, callbackUrl })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), callbackUrl);
      }
      assert.deepEqual(forwarded, []);
      assert.lengthOf(launches.pending(terminal), 1);
    }),
  );

  it.effect("accepts any unprivileged loopback origin when the URL advertised none", () =>
    Effect.gen(function* () {
      const { launches, forwarded } = yield* makeHarness();
      const capture = yield* launches.capture(terminal, deviceUrl);
      assert.isNull(capture!.redirectUri);
      for (const callbackUrl of [
        "https://127.0.0.1:8080/callback?code=x",
        "http://127.0.0.1:80/callback?code=x",
        "http://example.com:8080/callback?code=x",
        "http://user:pw@127.0.0.1:8080/callback?code=x",
      ]) {
        const result = yield* launches
          .complete({ ...terminal, captureId: capture!.captureId, callbackUrl })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), callbackUrl);
      }
      const callbackUrl = "http://localhost:8080/callback?token=x";
      yield* launches.complete({ ...terminal, captureId: capture!.captureId, callbackUrl });
      assert.deepEqual(forwarded, [callbackUrl]);
    }),
  );

  it.effect("keeps the capture pending when delivery fails, and drops it on cancel or clear", () =>
    Effect.gen(function* () {
      const { launches } = yield* makeHarness({ fail: true });
      const capture = yield* launches.capture(terminal, authorizeUrl);
      const failed = yield* launches
        .complete({
          ...terminal,
          captureId: capture!.captureId,
          callbackUrl: "http://127.0.0.1:46353/callback?code=abc&state=opaque-state",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(failed));
      assert.lengthOf(launches.pending(terminal), 1);
      assert.isTrue(launches.cancel({ ...terminal, captureId: capture!.captureId }));
      assert.isFalse(launches.cancel({ ...terminal, captureId: capture!.captureId }));

      const second = yield* launches.capture(terminal, deviceUrl);
      assert.deepEqual(launches.clear(terminal), [second!.captureId]);
      assert.deepEqual(launches.pending(terminal), []);
    }),
  );

  it.effect("expires captures on the relay deadline and ignores non-web URLs", () =>
    Effect.gen(function* () {
      const { launches, forwarded } = yield* makeHarness();
      assert.isNull(yield* launches.capture(terminal, "file:///etc/passwd"));
      assert.isNull(yield* launches.capture(terminal, "not a url"));
      const capture = yield* launches.capture(terminal, authorizeUrl);
      yield* TestClock.adjust("300 seconds");
      const late = yield* launches
        .complete({
          ...terminal,
          captureId: capture!.captureId,
          callbackUrl: "http://127.0.0.1:46353/callback?code=abc&state=opaque-state",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(late));
      assert.deepEqual(forwarded, []);
      assert.deepEqual(launches.pending(terminal), []);
    }),
  );
});
