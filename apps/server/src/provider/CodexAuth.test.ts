import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, type ProviderAuthState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as CodexErrors from "effect-codex-app-server/errors";

import { makeCodexAuth, type CodexAuthClient } from "./CodexAuth.ts";

const instanceId = ProviderInstanceId.make("codex-auth-test");
const owner = "session-owner";
const authUrl =
  "https://auth.openai.com/oauth/authorize?response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=codex-state";

type LoginCompleted = { success: boolean; loginId?: string | null; error?: string | null };

const phase = (
  auth: Awaited<ReturnType<typeof makeHarness>> extends Effect.Effect<infer A, any, any>
    ? A
    : never,
  value: ProviderAuthState["phase"],
) =>
  auth.flow.controller.subscribe(owner).pipe(
    Stream.filter((state) => state.phase === value),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const makeHarness = Effect.fn("makeHarness")(function* (
  options: { readonly deviceCode?: boolean } = {},
) {
  const requests: string[] = [];
  let completeLogin: ((payload: LoginCompleted) => Effect.Effect<void>) | undefined;
  let refreshed = 0;
  const client: CodexAuthClient = {
    request: ((method: string, params: unknown) =>
      Effect.gen(function* () {
        requests.push(method);
        if (method === "account/login/start") {
          const type = (params as { type: string }).type;
          if (type === "chatgptDeviceCode") {
            if (!options.deviceCode) {
              return yield* new CodexErrors.CodexAppServerRequestError({
                code: -32602,
                errorMessage: "unknown variant `chatgptDeviceCode`",
                method,
                operation: "receive-response",
              });
            }
            return {
              type: "chatgptDeviceCode",
              loginId: "login-1",
              userCode: "ABCD-EFGH",
              verificationUrl: "https://auth.openai.com/codex/device",
            };
          }
          return { type: "chatgpt", loginId: "login-2", authUrl };
        }
        if (method === "account/login/cancel") return { status: "canceled" };
        return {};
      })) as CodexAuthClient["request"],
    handleServerNotification: ((
      _method: string,
      handler: (payload: unknown) => Effect.Effect<void>,
    ) =>
      Effect.sync(() => {
        completeLogin = (payload) => handler(payload);
      })) as CodexAuthClient["handleServerNotification"],
  };
  const flow = yield* makeCodexAuth({
    instanceId,
    withClient: Effect.gen(function* () {
      requests.push("spawn");
      yield* Effect.addFinalizer(() => Effect.sync(() => void requests.push("close")));
      return client;
    }),
    refreshSnapshot: Effect.sync(() => {
      refreshed += 1;
    }),
  });
  return {
    flow,
    requests,
    refreshed: () => refreshed,
    completeLogin: (payload: LoginCompleted) =>
      Effect.suspend(() => completeLogin?.(payload) ?? Effect.die("no login handler")),
  };
});

it.layer(NodeServices.layer)("CodexAuth", (it) => {
  it.effect("prefers device code and finishes only on the login-completed notification", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ deviceCode: true });
      yield* harness.flow.controller.start(owner);
      const waiting = yield* phase(harness, "waiting");
      assert.equal(waiting.userCode, "ABCD-EFGH");
      assert.equal(waiting.authorizationUrl, "https://auth.openai.com/codex/device");
      assert.equal(harness.refreshed(), 0);

      yield* harness.completeLogin({ success: true, loginId: "login-1" });
      const succeeded = yield* phase(harness, "succeeded");
      assert.equal(succeeded.message, "Signed in to Codex.");
      assert.equal(harness.refreshed(), 1);
      assert.deepEqual(harness.requests, ["spawn", "account/login/start", "close"]);
    }),
  );

  it.effect("falls back to the ChatGPT loopback flow and relays its callback", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      const waiting = yield* phase(harness, "waiting");
      assert.equal(waiting.authorizationUrl, authUrl);
      assert.isUndefined(waiting.userCode);
      assert.deepEqual(harness.requests, ["spawn", "account/login/start", "account/login/start"]);

      const wrongListener = yield* harness.flow.controller
        .complete(owner, {
          flowId: state.flowId!,
          callbackUrl: "http://127.0.0.1:1455/auth/callback?code=x&state=codex-state",
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(wrongListener));

      yield* harness.completeLogin({ success: false, loginId: "login-2", error: "access_denied" });
      const failed = yield* phase(harness, "failed");
      assert.include(failed.message, "not approved");
      assert.equal(harness.refreshed(), 0);
    }),
  );

  it.effect("cancel tells Codex to stop the login and closes the app-server", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ deviceCode: true });
      const state = yield* harness.flow.controller.start(owner);
      yield* phase(harness, "waiting");
      const cancelled = yield* harness.flow.controller.cancel(owner, state.flowId!);
      assert.equal(cancelled.phase, "cancelled");
      assert.deepEqual(harness.requests, [
        "spawn",
        "account/login/start",
        "account/login/cancel",
        "close",
      ]);
    }),
  );

  it.effect("sign-out runs account/logout and refreshes the snapshot", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.flow.controller.logout(Effect.void);
      assert.equal(result.phase, "idle");
      assert.deepEqual(harness.requests, ["spawn", "account/logout", "close"]);
      assert.equal(harness.refreshed(), 1);
    }),
  );
});
