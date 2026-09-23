import * as Effect from "effect/Effect";

import { AuthRelayError } from "../auth-relay/AuthRelayError.ts";
import {
  validateLoopbackCallbackUrl,
  type PendingLoopbackCallback,
} from "../auth-relay/loopbackCallback.ts";

const GOOGLE_ISSUER = "https://accounts.google.com";

/**
 * Google's checks on top of the loopback rules: the listener is always on
 * `127.0.0.1`, and an `iss` parameter, when present, must name Google.
 */
export const validateAntigravityCallbackUrl = Effect.fn("validateAntigravityCallbackUrl")(
  function* (
    pending: PendingLoopbackCallback,
    callbackUrl: string,
  ): Effect.fn.Return<URL, AuthRelayError> {
    const callback = yield* validateLoopbackCallbackUrl(pending, callbackUrl);
    const issuers = callback.searchParams.getAll("iss");
    if (
      callback.hostname !== "127.0.0.1" ||
      issuers.length > 1 ||
      (issuers.length === 1 && issuers[0] !== GOOGLE_ISSUER)
    ) {
      return yield* new AuthRelayError({
        operation: "complete",
        detail: "The redirect URL is not a Google sign-in response.",
      });
    }
    return callback;
  },
);
