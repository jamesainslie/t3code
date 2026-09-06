import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexErrors from "effect-codex-app-server/errors";

import { makeAuthRelayFlow, type AuthRelayFlow } from "../auth-relay/AuthRelayFlow.ts";
import { parseLoopbackAuthorizationUrl } from "../auth-relay/loopbackCallback.ts";

const isSetupError = Schema.is(ProviderSetupError);

/** The slice of the app-server client the sign-in needs; tests supply a fake. */
export type CodexAuthClient = Pick<
  CodexClient.CodexAppServerClient["Service"],
  "request" | "handleServerNotification"
>;

export interface CodexAuthOptions {
  readonly instanceId: ProviderInstanceId;
  /** A connected, initialized app-server for the instance's home; closed with the scope. */
  readonly withClient: Effect.Effect<
    CodexAuthClient,
    CodexErrors.CodexAppServerError | ProviderSetupError,
    Scope.Scope
  >;
  /** Re-reads the account so the snapshot reflects the new sign-in state. */
  readonly refreshSnapshot: Effect.Effect<void>;
}

type CodexAuthFailure = CodexErrors.CodexAppServerError | ProviderSetupError;

function describeFailure(cause: Cause.Cause<CodexAuthFailure>): string {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error) && isSetupError(error.value)) return error.value.detail;
  return "Codex sign-in failed. Start sign-in again.";
}

/**
 * Codex sign-in through the app-server's login RPCs. Device code needs no
 * callback at all, so it is tried first; older app-servers that reject it
 * get the ChatGPT flow, whose loopback listener the relay replays to. Only
 * the app-server's login-completed notification finishes the flow.
 */
export const makeCodexAuth = Effect.fn("makeCodexAuth")(function* (
  options: CodexAuthOptions,
): Effect.fn.Return<AuthRelayFlow, never, Crypto.Crypto | Scope.Scope> {
  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });

  return yield* makeAuthRelayFlow<CodexAuthFailure>({
    instanceId: options.instanceId,
    copy: {
      starting: "Starting Codex sign-in.",
      waiting: "Open the sign-in link. If you are remote, paste the return URL here.",
      waitingForDeviceCode: "Open the sign-in page and enter the code shown here.",
      verifyingCallback: "Waiting for Codex to finish sign-in.",
      succeeded: "Signed in to Codex.",
      expired: "Codex sign-in expired. Start sign-in again.",
      cancelled: "Codex sign-in was cancelled.",
      cancelledBySignOut: "Codex sign-in was cancelled by sign-out.",
      signedOut: "Signed out of Codex.",
      signOutFailed: "Codex sign-out failed. Try again.",
      signOutTimedOut: "Codex sign-out timed out.",
      busy: "Codex setup is already in progress.",
      processBusy: "Codex sign-in or sign-out is in progress. Try again after it finishes.",
      describeFailure,
    },
    parseAuthorizationUrl: parseLoopbackAuthorizationUrl,
    signIn: (handle) =>
      Effect.gen(function* () {
        const client = yield* options.withClient;
        const completed = yield* Deferred.make<void, ProviderSetupError>();
        let loginId: string | undefined;
        yield* client.handleServerNotification("account/login/completed", (payload) =>
          Effect.gen(function* () {
            if (loginId !== undefined && payload.loginId && payload.loginId !== loginId) return;
            if (payload.success) {
              yield* Deferred.succeed(completed, undefined);
              return;
            }
            // Codex's own error text can name the account or carry a code.
            yield* Deferred.fail(
              completed,
              setupError(
                "start",
                /denied|cancel/i.test(payload.error ?? "")
                  ? "Codex sign-in was not approved. Start sign-in again."
                  : "Codex could not finish sign-in. Start sign-in again.",
              ),
            );
          }),
        );
        const started = yield* client
          .request("account/login/start", { type: "chatgptDeviceCode" })
          .pipe(Effect.catch(() => client.request("account/login/start", { type: "chatgpt" })));
        switch (started.type) {
          case "chatgptDeviceCode":
            loginId = started.loginId;
            yield* handle.receiveDeviceCode({
              userCode: started.userCode,
              verificationUrl: started.verificationUrl,
            });
            break;
          case "chatgpt":
            loginId = started.loginId;
            yield* handle
              .receiveAuthorizationUrl(started.authUrl)
              .pipe(Effect.mapError((error) => setupError("start", error.detail)));
            break;
          default:
            return yield* setupError("start", "Codex started a sign-in T3 Code cannot relay.");
        }
        // Cancel or expiry closes this scope before completion; tell Codex so
        // its listener and device-code polling stop with the process.
        yield* Effect.addFinalizer(() =>
          Deferred.isDone(completed).pipe(
            Effect.flatMap((done) =>
              done || loginId === undefined
                ? Effect.void
                : client.request("account/login/cancel", { loginId }).pipe(Effect.ignore),
            ),
          ),
        );
        yield* Deferred.await(completed);
        yield* handle.verifying("Checking the Codex account.");
        yield* options.refreshSnapshot;
      }),
    signOut: Effect.gen(function* () {
      const client = yield* options.withClient;
      yield* client.request("account/logout", undefined);
      yield* options.refreshSnapshot;
    }),
  });
});
