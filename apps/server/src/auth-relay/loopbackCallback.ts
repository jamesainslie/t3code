// @effect-diagnostics nodeBuiltinImport:off - node:http sends the one-shot loopback callback with no proxy, redirect handling, or response logging.
import * as NodeHttp from "node:http";

import * as Effect from "effect/Effect";

import { AuthRelayError } from "./AuthRelayError.ts";

/**
 * A loopback listener that a sign-in started on this environment is waiting
 * on. `redirectUri` is the exact origin and path the tool advertised; `state`
 * is the request's CSRF token when the tool put one in the authorization URL.
 */
export interface PendingLoopbackCallback {
  readonly redirectUri: string;
  readonly state?: string | undefined;
}

export type LoopbackCallbackForwarder = (callback: URL) => Effect.Effect<void, AuthRelayError>;

export const MAX_CALLBACK_URL_LENGTH = 16_384;
const MIN_UNPRIVILEGED_PORT = 1_024;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const FORWARD_TIMEOUT = "10 seconds";
export const CALLBACK_FORWARDING_FAILED_MESSAGE =
  "Could not deliver the sign-in response. Start sign-in again.";

/**
 * Reads a `redirect_uri` a tool advertised for its own loopback listener.
 * Only `http://127.0.0.1:<port>` and `http://localhost:<port>` on an
 * unprivileged port qualify, with a path and nothing else. Anything else is
 * not a listener T3 can replay a callback against.
 */
export function parseLoopbackRedirectUri(value: string): URL | null {
  if (value.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTNAMES.has(url.hostname) ||
    !/^[1-9][0-9]{0,4}$/.test(url.port) ||
    Number(url.port) < MIN_UNPRIVILEGED_PORT ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }
  return url;
}

/**
 * Accepts only the return URL for the registered listener: same origin and
 * path, the registered state when there is one, and exactly one OAuth
 * response (`code` or `error`). Failures never quote the URL.
 */
export const validateLoopbackCallbackUrl = Effect.fn("validateLoopbackCallbackUrl")(function* (
  pending: PendingLoopbackCallback,
  callbackUrl: string,
): Effect.fn.Return<URL, AuthRelayError> {
  const invalid = (detail: string) => new AuthRelayError({ operation: "complete", detail });
  if (callbackUrl.length > MAX_CALLBACK_URL_LENGTH) {
    return yield* invalid("The sign-in return URL is too long.");
  }
  const callback = yield* Effect.try({
    try: () => new URL(callbackUrl),
    catch: () => invalid("Paste the complete return URL from the final sign-in page."),
  });
  const expected = parseLoopbackRedirectUri(pending.redirectUri);
  if (
    expected === null ||
    callback.protocol !== "http:" ||
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname ||
    callback.username !== "" ||
    callback.password !== "" ||
    callback.hash !== ""
  ) {
    return yield* invalid("This return URL does not belong to the current sign-in.");
  }
  const states = callback.searchParams.getAll("state");
  if (
    pending.state !== undefined
      ? states.length !== 1 || states[0] !== pending.state
      : states.length > 1
  ) {
    return yield* invalid("This return URL does not belong to the current sign-in.");
  }
  const codes = callback.searchParams.getAll("code");
  const errors = callback.searchParams.getAll("error");
  if (
    !(
      (codes.length === 1 && Boolean(codes[0]) && errors.length === 0) ||
      (errors.length === 1 && Boolean(errors[0]) && codes.length === 0)
    )
  ) {
    return yield* invalid("The return URL must contain one sign-in response.");
  }
  return callback;
});

/** The OAuth response inside a callback that passed `validateLoopbackCallbackUrl`. */
export function readLoopbackCallbackResponse(callback: URL):
  | { readonly code: string; readonly state: string | null }
  | {
      readonly error: string;
      readonly state: string | null;
    } {
  const state = callback.searchParams.get("state");
  const code = callback.searchParams.get("code");
  return code ? { code, state } : { error: callback.searchParams.get("error") ?? "", state };
}

/**
 * Replays one validated callback against the listener on this environment:
 * a raw GET with no proxy, no redirects, and no logging of the URL or the
 * response body. A 2xx means the listener took the request, not that the
 * tool finished authenticating.
 */
export const forwardLoopbackCallback: LoopbackCallbackForwarder = (callback) =>
  Effect.callback<void, AuthRelayError>((resume) => {
    const failed = () =>
      new AuthRelayError({ operation: "complete", detail: CALLBACK_FORWARDING_FAILED_MESSAGE });
    let response: NodeHttp.IncomingMessage | undefined;
    const request = NodeHttp.request(
      {
        protocol: "http:",
        hostname: callback.hostname,
        port: callback.port,
        path: `${callback.pathname}${callback.search}`,
        method: "GET",
        agent: false,
      },
      (incoming) => {
        response = incoming;
        incoming.once("error", () => resume(Effect.fail(failed())));
        incoming.once("end", () => {
          const status = incoming.statusCode ?? 0;
          resume(status >= 200 && status < 300 ? Effect.void : Effect.fail(failed()));
        });
        incoming.resume();
      },
    );
    request.once("error", () => resume(Effect.fail(failed())));
    request.end();
    return Effect.sync(() => {
      request.destroy();
      response?.destroy();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: FORWARD_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new AuthRelayError({
            operation: "complete",
            detail: "The sign-in response timed out. Start sign-in again.",
          }),
        ),
    }),
  );
