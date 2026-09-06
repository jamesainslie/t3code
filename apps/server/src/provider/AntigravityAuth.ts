import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as AcpErrors from "effect-acp/errors";

import { AuthRelayError } from "../auth-relay/AuthRelayError.ts";
import { makeAuthRelayFlow, type AuthRelayFlow } from "../auth-relay/AuthRelayFlow.ts";
import type { AcpSessionRuntime, AcpSessionRuntimeStartResult } from "./acp/AcpSessionRuntime.ts";
import { parseAntigravityAuthorizationUrl } from "./antigravityAuthSupport.ts";
import { validateAntigravityCallbackUrl } from "./antigravityCallback.ts";

const isSetupError = Schema.is(ProviderSetupError);
const isAcpRequestError = Schema.is(AcpErrors.AcpRequestError);

/** The generic relay flow, driven by Antigravity's ACP runtime. */
export type AntigravityAuth = AuthRelayFlow;

export type AntigravityAuthRuntime = Pick<
  AcpSessionRuntime["Service"],
  "initialize" | "start" | "request"
>;

export interface AntigravityAuthOptions<
  Runtime extends AntigravityAuthRuntime = AcpSessionRuntime["Service"],
> {
  readonly instanceId: ProviderInstanceId;
  readonly makeRuntime: (input: {
    readonly onAuthorizationUrl?: (url: string) => Effect.Effect<void, AcpErrors.AcpError>;
  }) => Effect.Effect<Runtime, AcpErrors.AcpError | ProviderSetupError, Scope.Scope>;
  readonly onAuthenticated: (
    result: AcpSessionRuntimeStartResult,
    runtime: Runtime,
  ) => Effect.Effect<void>;
  readonly onSignedOut: Effect.Effect<void>;
  readonly forwardCallback?: (callback: URL) => Effect.Effect<void, ProviderSetupError>;
  /** False for API key methods, which authenticate without a Google sign-in page. */
  readonly usesBrowser?: boolean;
}

function safeAuthFailure(cause: Cause.Cause<unknown>, usesBrowser: boolean): string {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    if (isSetupError(error.value)) {
      return error.value.detail;
    }
    if (isAcpRequestError(error.value)) {
      if (error.value.errorMessage.includes("SUBSCRIPTION_REQUIRED")) {
        return "Google requires an eligible Antigravity subscription for this account.";
      }
      if (/access_denied|denied access|cancelled/i.test(error.value.errorMessage)) {
        return "Google sign-in was not approved. Start sign-in again.";
      }
      if (error.value.method === "session/new" && error.value.code === -32603) {
        return "Antigravity authenticated, but could not initialize a session or load models.";
      }
      if (!usesBrowser && error.value.code === -32602) {
        return "Antigravity rejected the configured credentials. Check the provider settings.";
      }
    }
  }
  return usesBrowser
    ? "Google sign-in failed. Start sign-in again."
    : "Antigravity could not authenticate with the configured credentials.";
}

/**
 * Owns one instance's explicit sign-in and all process admission around
 * sign-out. The ACP process owns token exchange and storage; T3 only relays
 * the Google callback to the process's loopback listener.
 */
export const makeAntigravityAuth = Effect.fn("makeAntigravityAuth")(function* <
  Runtime extends AntigravityAuthRuntime,
>(
  options: AntigravityAuthOptions<Runtime>,
): Effect.fn.Return<AntigravityAuth, never, Crypto.Crypto | Scope.Scope> {
  const usesBrowser = options.usesBrowser ?? true;
  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });

  return yield* makeAuthRelayFlow<AcpErrors.AcpError | ProviderSetupError>({
    instanceId: options.instanceId,
    copy: {
      starting: usesBrowser ? "Starting Google sign-in." : "Checking credentials.",
      waiting: "Open the Google sign-in link. If you are remote, paste the redirect URL here.",
      waitingForDeviceCode: "Open the Google sign-in link and enter the code.",
      verifyingCallback: "Waiting for Google to finish sign-in.",
      succeeded: usesBrowser ? "Signed in with Google." : "Connected to Antigravity.",
      expired: "Google sign-in expired. Start sign-in again.",
      cancelled: "Google sign-in was cancelled.",
      cancelledBySignOut: "Google sign-in was cancelled by sign-out.",
      signedOut: "Signed out of Google.",
      signOutFailed: "Antigravity sign-out failed. Try again.",
      signOutTimedOut: "Antigravity sign-out timed out.",
      busy: "Antigravity setup is already in progress.",
      processBusy: "Antigravity sign-in or sign-out is in progress. Try again after it finishes.",
      describeFailure: (cause) => safeAuthFailure(cause, usesBrowser),
    },
    parseAuthorizationUrl: (url) =>
      parseAntigravityAuthorizationUrl(url).pipe(
        Effect.map((authorization) => ({
          authorizationUrl: authorization.authorizationUrl,
          callback: { redirectUri: authorization.redirectUri, state: authorization.state },
        })),
        Effect.mapError(
          () =>
            new AuthRelayError({
              operation: "start",
              detail: "Antigravity returned an invalid Google sign-in URL.",
            }),
        ),
      ),
    signIn: (handle) =>
      Effect.gen(function* () {
        const runtime = yield* options.makeRuntime({
          onAuthorizationUrl: (url) =>
            handle
              .receiveAuthorizationUrl(url)
              .pipe(
                Effect.mapError(
                  (error) =>
                    new AcpErrors.AcpTransportError({ detail: error.detail, cause: undefined }),
                ),
              ),
        });
        const started = yield* runtime.start();
        yield* handle.verifying("Checking Antigravity access and models.");
        yield* options.onAuthenticated(started, runtime);
      }),
    signOut: Effect.gen(function* () {
      const runtime = yield* options.makeRuntime({});
      const initialized = yield* runtime.initialize();
      if (!initialized.agentCapabilities?.auth?.logout) {
        return yield* setupError(
          "logout",
          "This Antigravity version does not support sign-out. Update the provider.",
        );
      }
      yield* runtime.request("logout", {});
      yield* options.onSignedOut;
    }),
    validateCallback: validateAntigravityCallbackUrl,
    ...(options.forwardCallback
      ? {
          forwardCallback: (callback: URL) =>
            options.forwardCallback!(callback).pipe(
              Effect.mapError(
                (error) => new AuthRelayError({ operation: "complete", detail: error.detail }),
              ),
            ),
        }
      : {}),
    isLogoutPrompt: (text, hasAttachments) => !hasAttachments && text.trim() === "/logout",
  });
});
