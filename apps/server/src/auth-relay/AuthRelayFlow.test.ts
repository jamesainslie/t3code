import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSetupError, type ProviderAuthState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { AuthRelayError } from "./AuthRelayError.ts";
import {
  makeAuthRelayFlow,
  visibleAuthState,
  type AuthRelayCopy,
  type AuthRelayFlow,
} from "./AuthRelayFlow.ts";
import { parseLoopbackRedirectUri } from "./loopbackCallback.ts";

const instanceId = ProviderInstanceId.make("relay-test");
const owner = "session-owner";
const otherOwner = "session-other";
const authorizationUrl =
  "https://auth.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A51234%2Fcallback&state=test-state";
const callbackUrl = "http://127.0.0.1:51234/callback?state=test-state&code=test-code";

class SignInFailure extends Error {
  readonly _tag = "SignInFailure";
}

type DriverError = SignInFailure | AuthRelayError;
const isSetupError = Schema.is(ProviderSetupError);
const isRelayError = Schema.is(AuthRelayError);

const copy: AuthRelayCopy<DriverError> = {
  starting: "Starting sign-in.",
  waiting: "Open the link.",
  waitingForDeviceCode: "Enter the code.",
  verifyingCallback: "Waiting for the provider.",
  succeeded: "Signed in.",
  expired: "Sign-in expired.",
  cancelled: "Sign-in cancelled.",
  cancelledBySignOut: "Sign-in cancelled by sign-out.",
  signedOut: "Signed out.",
  signOutFailed: "Sign-out failed.",
  signOutTimedOut: "Sign-out timed out.",
  busy: "Busy.",
  processBusy: "Process busy.",
  describeFailure: (cause) =>
    Option.match(Cause.findErrorOption(cause), {
      onNone: () => "Failed for another reason.",
      onSome: (error) =>
        isSetupError(error) || isRelayError(error) ? error.detail : "Sign-in was not approved.",
    }),
};

const phase = (flow: AuthRelayFlow, value: ProviderAuthState["phase"], sessionId = owner) =>
  flow.controller.subscribe(sessionId).pipe(
    Stream.filter((state) => state.phase === value),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const makeHarness = Effect.fn("makeHarness")(function* (
  options: {
    readonly deviceCode?: boolean;
    readonly urls?: ReadonlyArray<string>;
    readonly forward?: Effect.Effect<void, AuthRelayError>;
  } = {},
) {
  const authenticated = yield* Deferred.make<void, SignInFailure>();
  const events: string[] = [];
  let forwarded = 0;
  const flow = yield* makeAuthRelayFlow<DriverError>({
    instanceId,
    copy,
    parseAuthorizationUrl: (url) =>
      Effect.gen(function* () {
        const parsed = new URL(url);
        const redirect = parseLoopbackRedirectUri(parsed.searchParams.get("redirect_uri") ?? "");
        if (!redirect) {
          return yield* new AuthRelayError({ operation: "start", detail: "Bad URL." });
        }
        return {
          authorizationUrl: url,
          callback: { redirectUri: redirect.href, state: parsed.searchParams.get("state") ?? "" },
        };
      }),
    signIn: (handle) =>
      Effect.gen(function* () {
        events.push("sign-in");
        yield* Effect.addFinalizer(() => Effect.sync(() => void events.push("sign-in-close")));
        if (options.deviceCode) {
          yield* handle.receiveDeviceCode({
            userCode: "ABCD-EFGH",
            verificationUrl: "https://auth.example.com/device",
          });
        } else {
          for (const url of options.urls ?? [authorizationUrl]) {
            yield* handle.receiveAuthorizationUrl(url);
          }
        }
        yield* Deferred.await(authenticated);
        yield* handle.verifying("Loading account.");
        events.push("authenticated");
      }),
    signOut: Effect.sync(() => void events.push("sign-out")),
    forwardCallback: () =>
      options.forward ??
      Effect.sync(() => {
        forwarded += 1;
      }),
  });
  return { flow, authenticated, events, forwarded: () => forwarded };
});

it.layer(NodeServices.layer)("AuthRelayFlow", (it) => {
  it.effect("relays the owned callback and succeeds only when the driver confirms", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      assert.equal(state.phase, "starting");
      const waiting = yield* phase(harness.flow, "waiting");
      assert.equal(waiting.authorizationUrl, authorizationUrl);

      const verifying = yield* harness.flow.controller.complete(owner, {
        flowId: state.flowId!,
        callbackUrl,
      });
      assert.equal(verifying.phase, "verifying");
      assert.isNull(verifying.authorizationUrl);
      assert.equal(harness.forwarded(), 1);
      assert.notInclude(harness.events, "authenticated");

      yield* Deferred.succeed(harness.authenticated, undefined);
      const succeeded = yield* phase(harness.flow, "succeeded");
      assert.equal(succeeded.message, "Signed in.");
      assert.isNull(succeeded.expiresAt);
      assert.deepEqual(harness.events, ["sign-in", "authenticated", "sign-in-close"]);
    }),
  );

  it.effect("hides the URL, code, and flow id from other clients", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ deviceCode: true });
      const state = yield* harness.flow.controller.start(owner);
      const waiting = yield* phase(harness.flow, "waiting");
      assert.equal(waiting.userCode, "ABCD-EFGH");
      assert.equal(waiting.authorizationUrl, "https://auth.example.com/device");

      const other = yield* phase(harness.flow, "waiting", otherOwner);
      assert.isNull(other.flowId);
      assert.isNull(other.authorizationUrl);
      assert.isUndefined(other.userCode);
      assert.equal(other.message, "Sign-in is in progress in another client.");

      const competing = yield* harness.flow.controller.start(otherOwner).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(competing));
      const stolen = yield* harness.flow.controller
        .complete(otherOwner, { flowId: state.flowId!, callbackUrl })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(stolen));

      // A device-code flow has no listener to relay to.
      const noCallback = yield* harness.flow.controller
        .complete(owner, { flowId: state.flowId!, callbackUrl })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(noCallback));
      assert.equal(harness.forwarded(), 0);

      yield* Deferred.succeed(harness.authenticated, undefined);
      const succeeded = yield* phase(harness.flow, "succeeded");
      assert.isUndefined(succeeded.userCode);
    }),
  );

  it("strips the user code from a non-owner view", () => {
    const state = visibleAuthState(
      {
        ownerSessionId: owner,
        state: {
          instanceId,
          phase: "waiting",
          flowId: "flow",
          authorizationUrl: "https://auth.example.com/device",
          userCode: "ABCD-EFGH",
          expiresAt: null,
          message: null,
        },
      },
      otherOwner,
    );
    assert.isFalse("userCode" in state);
    assert.isNull(state.authorizationUrl);
  });

  it.effect("accepts a repeated URL and fails on a different second one", () =>
    Effect.gen(function* () {
      const same = yield* makeHarness({ urls: [authorizationUrl, authorizationUrl] });
      yield* same.flow.controller.start(owner);
      yield* phase(same.flow, "waiting");
      yield* Deferred.succeed(same.authenticated, undefined);
      yield* phase(same.flow, "succeeded");

      const different = yield* makeHarness({
        urls: [authorizationUrl, `${authorizationUrl}&scope=other`],
      });
      yield* different.flow.controller.start(owner);
      const failed = yield* phase(different.flow, "failed");
      assert.isNull(failed.authorizationUrl);
      assert.equal(failed.message, "The provider started more than one sign-in request.");
    }),
  );

  it.effect("rejects mismatched callbacks without forwarding and keeps the flow waiting", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      yield* phase(harness.flow, "waiting");
      for (const invalid of [
        callbackUrl.replace("51234", "51235"),
        callbackUrl.replace("test-state", "wrong-state"),
        callbackUrl.replace("/callback?", "/other?"),
      ]) {
        const result = yield* harness.flow.controller
          .complete(owner, { flowId: state.flowId!, callbackUrl: invalid })
          .pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), invalid);
      }
      assert.equal(harness.forwarded(), 0);
      assert.equal((yield* phase(harness.flow, "waiting")).authorizationUrl, authorizationUrl);
      const cancelled = yield* harness.flow.controller.cancel(owner, state.flowId!);
      assert.equal(cancelled.phase, "cancelled");
      assert.include(harness.events, "sign-in-close");
    }),
  );

  it.effect("fails the flow when delivery fails after the requesting client disconnects", () =>
    Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        forward: Deferred.await(gate).pipe(
          Effect.andThen(
            Effect.fail(new AuthRelayError({ operation: "complete", detail: "refused" })),
          ),
        ),
      });
      const state = yield* harness.flow.controller.start(owner);
      yield* phase(harness.flow, "waiting");
      const request = yield* harness.flow.controller
        .complete(owner, { flowId: state.flowId!, callbackUrl })
        .pipe(Effect.forkScoped);
      yield* phase(harness.flow, "verifying");
      yield* Fiber.interrupt(request);
      yield* Deferred.succeed(gate, undefined);
      const failed = yield* phase(harness.flow, "failed");
      assert.include(failed.message ?? "", "Could not deliver");
      assert.include(harness.events, "sign-in-close");
    }),
  );

  it.effect("expires at the deadline and refuses a late callback", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.flow.controller.start(owner);
      yield* phase(harness.flow, "waiting");
      yield* TestClock.adjust("300 seconds");
      const failed = yield* phase(harness.flow, "failed");
      assert.equal(failed.message, "Sign-in expired.");
      const late = yield* harness.flow.controller
        .complete(owner, { flowId: state.flowId!, callbackUrl })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(late));
      assert.equal(harness.forwarded(), 0);
    }),
  );

  it.effect("sign-out cancels the active flow, stops sessions, then runs the driver", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.flow.controller.start(owner);
      yield* phase(harness.flow, "waiting");
      const result = yield* harness.flow.controller.logout(
        Effect.sync(() => void harness.events.push("sessions-stop")),
      );
      assert.equal(result.phase, "idle");
      assert.equal(result.message, "Signed out.");
      assert.deepEqual(harness.events, ["sign-in", "sessions-stop", "sign-in-close", "sign-out"]);
      const view = yield* harness.flow.controller
        .subscribe(owner)
        .pipe(Stream.runHead, Effect.map(Option.getOrThrow));
      assert.equal(view.phase, "idle");
    }),
  );

  it.effect("sign-out surfaces a driver setup error and closes process admission meanwhile", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const flow = yield* makeAuthRelayFlow<never>({
        instanceId,
        copy: copy as AuthRelayCopy<never>,
        parseAuthorizationUrl: () =>
          Effect.fail(new AuthRelayError({ operation: "start", detail: "unused" })),
        signIn: () => Effect.void,
        signOut: Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          return yield* new ProviderSetupError({
            instanceId,
            operation: "logout",
            detail: "This version cannot sign out.",
          });
        }),
      });
      const logout = yield* flow.controller
        .logout(Effect.void)
        .pipe(Effect.exit, Effect.forkScoped);
      yield* Deferred.await(entered);
      const denied = yield* flow
        .withProcess(Effect.void, Effect.void)
        .pipe(Effect.scoped, Effect.exit);
      assert.isTrue(Exit.isFailure(denied));
      yield* Deferred.succeed(release, undefined);
      const result = yield* Fiber.join(logout);
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause);
        assert.isTrue(Option.isSome(error));
        if (Option.isSome(error)) assert.equal(error.value.detail, "This version cannot sign out.");
      }
      yield* flow.withProcess(Effect.void, Effect.void).pipe(Effect.scoped);
    }),
  );
});
