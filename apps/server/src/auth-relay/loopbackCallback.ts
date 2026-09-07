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

/**
 * One validated response on its way to a loopback listener. A query response
 * is replayed as the GET the browser would have made; a form response
 * (`response_mode=form_post`, as MSAL uses) is replayed as the POST the
 * browser made, with the body it posted.
 */
export type LoopbackCallbackDelivery =
  | { readonly method: "GET"; readonly url: URL }
  | { readonly method: "POST"; readonly url: URL; readonly body: string };

export type LoopbackCallbackForwarder = (
  delivery: LoopbackCallbackDelivery,
) => Effect.Effect<void, AuthRelayError>;

/** How a listener expects its response, read from the authorization request's `response_mode`. */
export type LoopbackResponseMode = "query" | "form_post";

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
 * it is only checked against that listener's callback. `responseMode` is how
 * the listener asked for its response; only `form_post` changes anything,
 * because the browser then posts the result instead of loading a URL a user
 * could copy.
 */
export function readAuthorizationRequestCallback(url: URL): {
  readonly redirectUri: string | null;
  readonly state: string | null;
  readonly responseMode: LoopbackResponseMode;
} {
  const redirectUris = url.searchParams.getAll("redirect_uri");
  const redirect = redirectUris.length === 1 ? parseLoopbackRedirectUri(redirectUris[0]!) : null;
  const states = url.searchParams.getAll("state");
  const state =
    states.length === 1 && states[0] && states[0].length <= 512 && !/\s/.test(states[0])
      ? states[0]
      : null;
  const responseMode =
    url.searchParams.get("response_mode") === "form_post" ? "form_post" : "query";
  return { redirectUri: redirect?.href ?? null, state: redirect ? state : null, responseMode };
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
 * The address a response arrived at, checked against the listener it must
 * belong to. With a pending listener it is that listener's exact origin and
 * path; without one (a launch that advertised no target) any unprivileged
 * loopback origin qualifies. Credentials and fragments never do.
 */
const parseLoopbackCallbackTarget = Effect.fn("parseLoopbackCallbackTarget")(function* (
  pending: PendingLoopbackCallback | null,
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
  if (callback.username !== "" || callback.password !== "" || callback.hash !== "") {
    return yield* invalid("This return URL does not belong to the current sign-in.");
  }
  if (pending === null) {
    if (parseLoopbackRedirectUri(`${callback.origin}/`) === null) {
      return yield* invalid("Paste the full address of the final 127.0.0.1 or localhost page.");
    }
    return callback;
  }
  const expected = parseLoopbackRedirectUri(pending.redirectUri);
  if (
    expected === null ||
    callback.protocol !== "http:" ||
    callback.origin !== expected.origin ||
    callback.pathname !== expected.pathname
  ) {
    return yield* invalid("This return URL does not belong to the current sign-in.");
  }
  return callback;
});

/**
 * The OAuth response fields themselves: the registered state when there is
 * one, and exactly one response (`code` or `error`). Shared by query and
 * form responses; the parameters differ only in where they were carried.
 */
const checkLoopbackResponseParams = Effect.fn("checkLoopbackResponseParams")(function* (
  expectedState: string | undefined,
  params: URLSearchParams,
  subject: string,
): Effect.fn.Return<void, AuthRelayError> {
  const invalid = (detail: string) => new AuthRelayError({ operation: "complete", detail });
  const states = params.getAll("state");
  if (
    expectedState !== undefined
      ? states.length !== 1 || states[0] !== expectedState
      : states.length > 1
  ) {
    return yield* invalid(`${subject} does not belong to the current sign-in.`);
  }
  const codes = params.getAll("code");
  const errors = params.getAll("error");
  if (
    !(
      (codes.length === 1 && Boolean(codes[0]) && errors.length === 0) ||
      (errors.length === 1 && Boolean(errors[0]) && codes.length === 0)
    )
  ) {
    return yield* invalid(`${subject} must contain one sign-in response.`);
  }
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
  const callback = yield* parseLoopbackCallbackTarget(pending, callbackUrl);
  yield* checkLoopbackResponseParams(pending.state, callback.searchParams, "This return URL");
  return callback;
});

/**
 * Accepts a form response a client-side listener caught: the posted-to
 * address must be the listener's (or any loopback origin when none was
 * advertised) with nothing in its query, and the urlencoded body must carry
 * the registered state and exactly one OAuth response. Failures never quote
 * the body.
 */
export const validateLoopbackCallbackForm = Effect.fn("validateLoopbackCallbackForm")(function* (
  pending: PendingLoopbackCallback | null,
  callbackUrl: string,
  body: string,
): Effect.fn.Return<Extract<LoopbackCallbackDelivery, { method: "POST" }>, AuthRelayError> {
  const invalid = (detail: string) => new AuthRelayError({ operation: "complete", detail });
  const callback = yield* parseLoopbackCallbackTarget(pending, callbackUrl);
  if (callback.search !== "") {
    return yield* invalid(
      "A posted sign-in response carries its result in the form, not the address.",
    );
  }
  if (body.length === 0 || body.length > MAX_CALLBACK_URL_LENGTH || /\s/.test(body)) {
    return yield* invalid("The posted sign-in response is missing or malformed.");
  }
  yield* checkLoopbackResponseParams(
    pending?.state,
    new URLSearchParams(body),
    "The posted sign-in response",
  );
  return { method: "POST", url: callback, body };
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
 * Replays one validated response against the listener on this environment:
 * the GET or form POST the browser would have made, raw, with no proxy, no
 * redirects, and no logging of the URL, body, or response. A 2xx means the
 * listener took the request, not that the tool finished authenticating.
 */
export const forwardLoopbackCallback: LoopbackCallbackForwarder = (delivery) =>
  Effect.callback<void, AuthRelayError>((resume) => {
    const failed = () =>
      new AuthRelayError({ operation: "complete", detail: CALLBACK_FORWARDING_FAILED_MESSAGE });
    const { url } = delivery;
    const body = delivery.method === "POST" ? Buffer.from(delivery.body, "utf8") : null;
    let response: NodeHttp.IncomingMessage | undefined;
    const request = NodeHttp.request(
      {
        protocol: "http:",
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: delivery.method,
        agent: false,
        ...(body
          ? {
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": String(body.byteLength),
              },
            }
          : {}),
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
    request.end(body ?? undefined);
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
