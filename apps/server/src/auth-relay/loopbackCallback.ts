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

/**
 * How the client's pasted return value reaches the tool once the user has
 * signed in on the page. Loopback: replay the return URL against the tool's
 * listener. Code: the page shows a code (or lands on a hosted callback URL)
 * that the tool takes on stdin. None: the tool finishes on its own, as with
 * device codes.
 */
export type AuthorizationCompletion =
  | { readonly kind: "loopback"; readonly callback: PendingLoopbackCallback }
  | { readonly kind: "code"; readonly state: string | null }
  | { readonly kind: "none" };

export interface PendingAuthorization {
  readonly authorizationUrl: string;
  readonly completion: AuthorizationCompletion;
}

export interface PastedAuthorizationCode {
  readonly code: string;
  readonly state: string | null;
}

const MAX_PASTED_CODE_LENGTH = 2_048;

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
 * The listener an authorization request names in its own query, when it is
 * one T3 can replay to. `state` rides along only with such a listener, since
 * it is only checked against that listener's callback.
 */
export function readAuthorizationRequestCallback(url: URL): {
  readonly redirectUri: string | null;
  readonly state: string | null;
} {
  const redirectUris = url.searchParams.getAll("redirect_uri");
  const redirect = redirectUris.length === 1 ? parseLoopbackRedirectUri(redirectUris[0]!) : null;
  const states = url.searchParams.getAll("state");
  const state =
    states.length === 1 && states[0] && states[0].length <= 512 && !/\s/.test(states[0])
      ? states[0]
      : null;
  return { redirectUri: redirect?.href ?? null, state: redirect ? state : null };
}

/**
 * Reads an authorization URL a tool printed for a loopback sign-in: an
 * `https` page that names a loopback `redirect_uri`. Anything else cannot be
 * completed through the relay. Failures never quote the URL.
 */
export const parseLoopbackAuthorizationUrl = Effect.fn("parseLoopbackAuthorizationUrl")(function* (
  authorizationUrl: string,
): Effect.fn.Return<PendingAuthorization, AuthRelayError> {
  const invalid = () =>
    new AuthRelayError({
      operation: "start",
      detail: "The sign-in link is not one T3 Code can finish from another device.",
    });
  if (authorizationUrl.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(authorizationUrl)) {
    return yield* invalid();
  }
  const url = yield* Effect.try({ try: () => new URL(authorizationUrl), catch: invalid });
  const { redirectUri, state } = readAuthorizationRequestCallback(url);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    redirectUri === null
  ) {
    return yield* invalid();
  }
  return {
    authorizationUrl,
    completion: { kind: "loopback", callback: { redirectUri, ...(state ? { state } : {}) } },
  };
});

/**
 * Reads what the user pasted for a code completion: the hosted callback
 * page's address (its query carries `code` and `state`), or the code the page
 * shows, optionally as `code#state`. The registered state must match when it
 * is present in either form. Failures never quote the value.
 */
export const readPastedAuthorizationCode = Effect.fn("readPastedAuthorizationCode")(function* (
  expectedState: string | null,
  value: string,
): Effect.fn.Return<PastedAuthorizationCode, AuthRelayError> {
  const invalid = (detail: string) => new AuthRelayError({ operation: "complete", detail });
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(trimmed)) {
    return yield* invalid("Paste the code from the final sign-in page, or that page's address.");
  }
  let code: string;
  let state: string | null;
  if (/^https?:\/\//i.test(trimmed)) {
    const url = yield* Effect.try({
      try: () => new URL(trimmed),
      catch: () => invalid("Paste the complete address of the final sign-in page."),
    });
    const codes = url.searchParams.getAll("code");
    const states = url.searchParams.getAll("state");
    if (url.protocol !== "https:" || codes.length !== 1 || !codes[0] || states.length > 1) {
      return yield* invalid("The address must be the final sign-in page with its code.");
    }
    code = codes[0];
    state = states[0] ?? null;
  } else {
    const separator = trimmed.indexOf("#");
    code = separator === -1 ? trimmed : trimmed.slice(0, separator);
    state = separator === -1 ? null : trimmed.slice(separator + 1);
  }
  if (code.length === 0 || code.length > MAX_PASTED_CODE_LENGTH) {
    return yield* invalid("Paste the code from the final sign-in page, or that page's address.");
  }
  if (expectedState !== null && state !== null && state !== expectedState) {
    return yield* invalid("This code does not belong to the current sign-in.");
  }
  return { code, state: state ?? expectedState };
});

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
