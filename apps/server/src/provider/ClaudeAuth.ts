import { ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { AuthRelayError } from "../auth-relay/AuthRelayError.ts";
import { makeAuthRelayFlow, type AuthRelayFlow } from "../auth-relay/AuthRelayFlow.ts";
import { makeBrowserLaunchStderrHandler } from "../auth-relay/browserLaunchCapture.ts";
import {
  MAX_CALLBACK_URL_LENGTH,
  parseLoopbackAuthorizationUrl,
  readAuthorizationRequestCallback,
  type PendingAuthorization,
} from "../auth-relay/loopbackCallback.ts";

export const CLAUDE_AUTH_BROWSER_MARKER = "__T3_CLAUDE_AUTH_URL__";
const isSetupError = Schema.is(ProviderSetupError);
const decoder = new TextDecoder();

/** A running `claude auth login`; tests supply a fake. */
export interface ClaudeLoginProcess {
  readonly stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
  readonly stderr: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
  readonly writeStdin: (text: string) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
}

export interface ClaudeAuthOptions {
  readonly instanceId: ProviderInstanceId;
  /** Spawns the login command with the instance's config dir and `BROWSER`; killed with the scope. */
  readonly spawnLogin: Effect.Effect<ClaudeLoginProcess, ProviderSetupError, Scope.Scope>;
  /** Runs the logout command to completion. */
  readonly runLogout: Effect.Effect<void, ProviderSetupError>;
  readonly refreshSnapshot: Effect.Effect<void>;
}

type ClaudeAuthFailure = ProviderSetupError;

/**
 * Claude Code's login URL. Spawned without a terminal, the CLI uses its
 * hosted code flow: the page returns to `platform.claude.com`, shows a code,
 * and the CLI takes that code on stdin. A loopback `redirect_uri`, should a
 * version print one, is relayed like any other provider's.
 */
export const parseClaudeAuthorizationUrl = Effect.fn("parseClaudeAuthorizationUrl")(function* (
  authorizationUrl: string,
): Effect.fn.Return<PendingAuthorization, AuthRelayError> {
  const invalid = () =>
    new AuthRelayError({
      operation: "start",
      detail: "Claude returned a sign-in link T3 Code cannot relay.",
    });
  if (authorizationUrl.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(authorizationUrl)) {
    return yield* invalid();
  }
  const url = yield* Effect.try({ try: () => new URL(authorizationUrl), catch: invalid });
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.searchParams.getAll("redirect_uri").length !== 1 ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("response_type") !== "code"
  ) {
    return yield* invalid();
  }
  const { redirectUri, state } = readAuthorizationRequestCallback(url);
  if (redirectUri !== null) return yield* parseLoopbackAuthorizationUrl(authorizationUrl);
  const hostedState = url.searchParams.get("state");
  return {
    authorizationUrl,
    completion: {
      kind: "code",
      state: hostedState && !/\s/.test(hostedState) ? hostedState : state,
    },
  };
});

function describeFailure(cause: Cause.Cause<ClaudeAuthFailure>): string {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error) && isSetupError(error.value)) return error.value.detail;
  return "Claude sign-in failed. Start sign-in again.";
}

/** The first `https://` token on a line that parses as Claude's sign-in request. */
const readStdoutUrls = (text: string): ReadonlyArray<string> =>
  Array.from(text.matchAll(/https:\/\/[^\s"'<>]+/g), (match) => match[0]);

/**
 * Claude sign-in by driving `claude auth login` as a child process. The URL
 * is captured from the `BROWSER` helper or from stdout, whichever fires
 * first; the pasted code goes to the child's stdin, matching the CLI's own
 * prompt. Success is the child exiting zero, after which the snapshot is
 * re-probed so the account shows up.
 */
export const makeClaudeAuth = Effect.fn("makeClaudeAuth")(function* (
  options: ClaudeAuthOptions,
): Effect.fn.Return<AuthRelayFlow, never, Crypto.Crypto | Scope.Scope> {
  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });
  let activeLogin: ClaudeLoginProcess | undefined;

  return yield* makeAuthRelayFlow<ClaudeAuthFailure>({
    instanceId: options.instanceId,
    copy: {
      starting: "Starting Claude sign-in.",
      waiting:
        "Open the sign-in link. When the final page shows a code, paste the code or that page's address here.",
      waitingForDeviceCode: "Open the sign-in page and enter the code shown here.",
      verifyingCallback: "Waiting for Claude to finish sign-in.",
      succeeded: "Signed in to Claude.",
      expired: "Claude sign-in expired. Start sign-in again.",
      cancelled: "Claude sign-in was cancelled.",
      cancelledBySignOut: "Claude sign-in was cancelled by sign-out.",
      signedOut: "Signed out of Claude.",
      signOutFailed: "Claude sign-out failed. Try again.",
      signOutTimedOut: "Claude sign-out timed out.",
      busy: "Claude setup is already in progress.",
      processBusy: "Claude sign-in or sign-out is in progress. Try again after it finishes.",
      describeFailure,
    },
    parseAuthorizationUrl: parseClaudeAuthorizationUrl,
    signIn: (handle) =>
      Effect.gen(function* () {
        const login = yield* options.spawnLogin;
        activeLogin = login;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (activeLogin === login) activeLogin = undefined;
          }),
        );
        const receive = (url: string) =>
          handle.receiveAuthorizationUrl(url).pipe(
            // A URL the CLI printed that is not its sign-in request is ordinary output.
            Effect.catch((error) =>
              error.detail.includes("more than one")
                ? Effect.fail(setupError("start", error.detail))
                : Effect.void,
            ),
          );
        const handleStderr = makeBrowserLaunchStderrHandler({
          marker: CLAUDE_AUTH_BROWSER_MARKER,
          onUrl: receive,
        });
        // The scanners die with this scope, so a URL printed after exit is never acted on.
        yield* login.stdout.pipe(
          Stream.decodeText(),
          Stream.mapEffect((text) =>
            Effect.forEach(readStdoutUrls(text), receive, { discard: true }),
          ),
          Stream.runDrain,
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped,
        );
        yield* login.stderr.pipe(
          Stream.runForEach((chunk) => handleStderr(decoder.decode(chunk, { stream: true }))),
          Effect.ignoreCause({ log: true }),
          Effect.forkScoped,
        );
        const exitCode = yield* login.exitCode.pipe(
          Effect.mapError(() => setupError("start", "Claude sign-in stopped before it finished.")),
        );
        if (exitCode !== 0) {
          return yield* setupError("start", "Claude sign-in did not finish. Start sign-in again.");
        }
        yield* handle.verifying("Checking the Claude account.");
        yield* options.refreshSnapshot;
      }),
    submitCode: (pasted) =>
      Effect.suspend(() => {
        const login = activeLogin;
        if (!login) {
          return Effect.fail(
            new AuthRelayError({ operation: "complete", detail: "Claude sign-in is not running." }),
          );
        }
        // The CLI's prompt takes `code#state`, the form its hosted page shows.
        return login.writeStdin(`${pasted.code}${pasted.state ? `#${pasted.state}` : ""}\n`).pipe(
          Effect.mapError(
            () =>
              new AuthRelayError({
                operation: "complete",
                detail: "Could not hand the code to Claude. Start sign-in again.",
              }),
          ),
        );
      }),
    signOut: Effect.gen(function* () {
      yield* options.runLogout;
      yield* options.refreshSnapshot;
    }),
  });
});
