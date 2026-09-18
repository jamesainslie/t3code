import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSetupError, type ProviderAuthState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  CLAUDE_AUTH_BROWSER_MARKER,
  makeClaudeAuth,
  parseClaudeAuthorizationUrl,
  type ClaudeLoginProcess,
} from "./ClaudeAuth.ts";

const instanceId = ProviderInstanceId.make("claude-auth-test");
const owner = "session-owner";
const hostedUrl =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=test&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Aprofile&code_challenge=abc&code_challenge_method=S256&state=hosted-state";
const loopbackUrl =
  "https://claude.ai/oauth/authorize?response_type=code&client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&state=loop-state";
const encode = (text: string) => new TextEncoder().encode(text);
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

it.effect("classifies Claude's hosted and loopback sign-in requests", () =>
  Effect.gen(function* () {
    const hosted = yield* parseClaudeAuthorizationUrl(hostedUrl);
    assert.deepEqual(hosted.completion, { kind: "code", state: "hosted-state" });
    const loopback = yield* parseClaudeAuthorizationUrl(loopbackUrl);
    assert.deepEqual(loopback.completion, {
      kind: "loopback",
      callback: { redirectUri: "http://localhost:54545/callback", state: "loop-state" },
    });
    for (const invalid of [
      "https://claude.com/docs",
      hostedUrl.replace("https:", "http:"),
      hostedUrl.replace("response_type=code", "response_type=token"),
      `${hostedUrl}#fragment`,
    ]) {
      const result = yield* parseClaudeAuthorizationUrl(invalid).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result), invalid);
    }
  }),
);

const makeHarness = Effect.fn("makeHarness")(function* () {
  const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const stderr = yield* Queue.unbounded<Uint8Array, Cause.Done<void>>();
  const exit = yield* Deferred.make<number>();
  const stdin: string[] = [];
  const events: string[] = [];
  let refreshed = 0;
  const login: ClaudeLoginProcess = {
    stdout: Stream.fromQueue(stdout),
    stderr: Stream.fromQueue(stderr),
    writeStdin: (text) => Effect.sync(() => void stdin.push(text)),
    exitCode: Deferred.await(exit),
  };
  const flow = yield* makeClaudeAuth({
    instanceId,
    spawnLogin: Effect.gen(function* () {
      events.push("spawn");
      yield* Effect.addFinalizer(() => Effect.sync(() => void events.push("kill")));
      return login;
    }),
    runLogout: Effect.sync(() => void events.push("logout")),
    refreshSnapshot: Effect.sync(() => {
      refreshed += 1;
    }),
  });
  const phase = (value: ProviderAuthState["phase"]) =>
    flow.controller.subscribe(owner).pipe(
      Stream.filter((state) => state.phase === value),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
  return {
    flow,
    phase,
    events,
    stdin,
    refreshed: () => refreshed,
    printStdout: (text: string) => Queue.offer(stdout, encode(text)),
    printStderr: (text: string) => Queue.offer(stderr, encode(text)),
    exitWith: (code: number) =>
      Effect.gen(function* () {
        yield* Deferred.succeed(exit, code);
        yield* Queue.end(stdout);
        yield* Queue.end(stderr);
      }),
  };
});

it.layer(NodeServices.layer)("ClaudeAuth", (it) => {
  it.effect("captures the hosted sign-in URL from stdout and hands the pasted code to stdin", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      yield* harness.printStdout(
        "Opening browser to sign in…\nIf the browser didn't open, visit: ",
      );
      yield* harness.printStdout(`${hostedUrl}\nPaste code here if prompted > `);
      const waiting = yield* harness.phase("waiting");
      assert.equal(waiting.authorizationUrl, hostedUrl);

      const wrongState = yield* harness.flow.controller
        .complete(owner, { flowId: state.flowId!, callbackUrl: "pasted-code#other-state" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(wrongState));
      assert.deepEqual(harness.stdin, []);

      const verifying = yield* harness.flow.controller.complete(owner, {
        flowId: state.flowId!,
        callbackUrl:
          "https://platform.claude.com/oauth/code/callback?code=pasted-code&state=hosted-state",
      });
      assert.equal(verifying.phase, "verifying");
      assert.deepEqual(harness.stdin, ["pasted-code#hosted-state\n"]);
      assert.equal(harness.refreshed(), 0);

      yield* harness.printStdout("Login successful\n");
      yield* harness.exitWith(0);
      const succeeded = yield* harness.phase("succeeded");
      assert.equal(succeeded.message, "Signed in to Claude.");
      assert.equal(harness.refreshed(), 1);
      assert.deepEqual(harness.events, ["spawn", "kill"]);
    }),
  );

  it.effect("takes the URL from the BROWSER helper too and fails when the CLI exits non-zero", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      yield* harness.printStderr(`${CLAUDE_AUTH_BROWSER_MARKER}${encodeJson(hostedUrl)}\n`);
      yield* harness.printStdout(`If the browser didn't open, visit: ${hostedUrl}\n`);
      yield* harness.phase("waiting");
      yield* harness.flow.controller.complete(owner, {
        flowId: state.flowId!,
        callbackUrl: "bare-code",
      });
      assert.deepEqual(harness.stdin, ["bare-code#hosted-state\n"]);
      yield* harness.exitWith(1);
      const failed = yield* harness.phase("failed");
      assert.include(failed.message, "did not finish");
      assert.equal(harness.refreshed(), 0);
    }),
  );

  it.effect("cancel kills the login process, and sign-out runs the logout command", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      yield* harness.printStdout(`visit: ${hostedUrl}\n`);
      yield* harness.phase("waiting");
      const cancelled = yield* harness.flow.controller.cancel(owner, state.flowId!);
      assert.equal(cancelled.phase, "cancelled");
      assert.deepEqual(harness.events, ["spawn", "kill"]);
      const late = yield* harness.flow.controller
        .complete(owner, { flowId: state.flowId!, callbackUrl: "code" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(late));

      const signedOut = yield* harness.flow.controller.logout(Effect.void);
      assert.equal(signedOut.phase, "idle");
      assert.include(harness.events, "logout");
      assert.equal(harness.refreshed(), 1);
    }),
  );

  it.effect("surfaces a spawn failure as safe text", () =>
    Effect.gen(function* () {
      const flow = yield* makeClaudeAuth({
        instanceId,
        spawnLogin: Effect.fail(
          new ProviderSetupError({
            instanceId,
            operation: "start",
            detail: "Claude Agent CLI (`claude`) was not found on PATH.",
          }),
        ),
        runLogout: Effect.void,
        refreshSnapshot: Effect.void,
      });
      yield* flow.controller.start(owner);
      const failed = yield* flow.controller.subscribe(owner).pipe(
        Stream.filter((state) => state.phase === "failed"),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      assert.include(failed.message, "not found on PATH");
    }),
  );
});
