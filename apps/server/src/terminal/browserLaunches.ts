import {
  TerminalBrowserLaunchError,
  type TerminalBrowserLaunchCancelInput,
  type TerminalBrowserLaunchCompleteInput,
  type TerminalBrowserLaunchEvent,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { AuthRelayError } from "../auth-relay/AuthRelayError.ts";
import { AUTH_RELAY_TIMEOUT_MS } from "../auth-relay/AuthRelayFlow.ts";
import { BROWSER_LAUNCH_URL_MAX_LENGTH } from "../auth-relay/browserLaunchCapture.ts";
import {
  forwardLoopbackCallback,
  parseLoopbackRedirectUri,
  readAuthorizationRequestCallback,
  validateLoopbackCallbackForm,
  validateLoopbackCallbackUrl,
  type LoopbackCallbackDelivery,
  type LoopbackCallbackForwarder,
  type LoopbackResponseMode,
} from "../auth-relay/loopbackCallback.ts";

/**
 * Pending browser launches per terminal.
 *
 * A capture is the URL a command wanted opened plus, when the URL advertised
 * one, the loopback listener it will wait on and how that listener wants its
 * response. Completing a capture replays the client's return, the final URL
 * or the form a client-side listener caught, against that listener once;
 * cancelling forgets it. A capture expires on the same deadline as a provider
 * sign-in. Unlike the provider flow, nothing here confirms that the tool
 * finished: the terminal output is the user's confirmation.
 */

type TerminalRef = { readonly threadId: string; readonly terminalId: string };

interface PendingBrowserLaunch {
  readonly captureId: string;
  readonly url: string;
  readonly redirectUri: string | null;
  readonly state: string | null;
  readonly responseMode: LoopbackResponseMode;
  readonly expiresAt: string;
  readonly expiresAtMillis: number;
  consumed: boolean;
}

export type TerminalBrowserLaunchCapture = Omit<
  TerminalBrowserLaunchEvent,
  "type" | "sequence" | "threadId" | "terminalId"
>;

export interface TerminalBrowserLaunches {
  /** Records a launch; null when the URL is not something a client should open. */
  readonly capture: (
    terminal: TerminalRef,
    url: string,
  ) => Effect.Effect<TerminalBrowserLaunchCapture | null>;
  readonly pending: (terminal: TerminalRef) => ReadonlyArray<TerminalBrowserLaunchCapture>;
  readonly complete: (
    input: TerminalBrowserLaunchCompleteInput,
  ) => Effect.Effect<void, TerminalBrowserLaunchError>;
  /** True when the capture existed and is now forgotten. */
  readonly cancel: (input: TerminalBrowserLaunchCancelInput) => boolean;
  /** Forgets every capture for the terminal, returning the ids that were still pending. */
  readonly clear: (terminal: TerminalRef) => ReadonlyArray<string>;
}

function key(terminal: TerminalRef): string {
  return `${terminal.threadId}\u0000${terminal.terminalId}`;
}

function toCapture(launch: PendingBrowserLaunch): TerminalBrowserLaunchCapture {
  return {
    captureId: launch.captureId,
    url: launch.url,
    redirectUri: launch.redirectUri,
    responseMode: launch.responseMode,
    expiresAt: launch.expiresAt,
  };
}

export const makeTerminalBrowserLaunches = Effect.fn("makeTerminalBrowserLaunches")(function* (
  options: { readonly forward?: LoopbackCallbackForwarder } = {},
): Effect.fn.Return<TerminalBrowserLaunches, never, Crypto.Crypto> {
  const crypto = yield* Crypto.Crypto;
  const forward = options.forward ?? forwardLoopbackCallback;
  const byTerminal = new Map<string, Map<string, PendingBrowserLaunch>>();

  const find = (input: TerminalRef & { readonly captureId: string }) =>
    byTerminal.get(key(input))?.get(input.captureId);
  const forget = (input: TerminalRef & { readonly captureId: string }) => {
    const launches = byTerminal.get(key(input));
    if (!launches) return false;
    const removed = launches.delete(input.captureId);
    if (launches.size === 0) byTerminal.delete(key(input));
    return removed;
  };

  return {
    capture: Effect.fn("terminalBrowserLaunches.capture")(function* (terminal, url) {
      if (url.length > BROWSER_LAUNCH_URL_MAX_LENGTH) return null;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      const captureId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
      const now = yield* Clock.currentTimeMillis;
      const expiresAtMillis = now + AUTH_RELAY_TIMEOUT_MS;
      const launch: PendingBrowserLaunch = {
        captureId,
        url,
        ...readAuthorizationRequestCallback(parsed),
        expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
        expiresAtMillis,
        consumed: false,
      };
      const launches = byTerminal.get(key(terminal)) ?? new Map<string, PendingBrowserLaunch>();
      for (const [id, existing] of launches) {
        if (existing.expiresAtMillis <= now) launches.delete(id);
      }
      launches.set(captureId, launch);
      byTerminal.set(key(terminal), launches);
      return toCapture(launch);
    }),
    pending: (terminal) =>
      Array.from(byTerminal.get(key(terminal))?.values() ?? [])
        .filter((launch) => !launch.consumed)
        .map(toCapture),
    complete: Effect.fn("terminalBrowserLaunches.complete")(function* (input) {
      const error = (detail: string) =>
        new TerminalBrowserLaunchError({
          threadId: input.threadId,
          terminalId: input.terminalId,
          captureId: input.captureId,
          detail,
        });
      const launch = find(input);
      if (!launch || launch.consumed) {
        return yield* error("This sign-in link is no longer waiting in this terminal.");
      }
      const now = yield* Clock.currentTimeMillis;
      if (now >= launch.expiresAtMillis) {
        forget(input);
        return yield* error("This sign-in link expired. Run the command again.");
      }
      const pending = launch.redirectUri
        ? { redirectUri: launch.redirectUri, ...(launch.state ? { state: launch.state } : {}) }
        : null;
      const validated: Effect.Effect<LoopbackCallbackDelivery, AuthRelayError> =
        input.formBody !== undefined
          ? validateLoopbackCallbackForm(pending, input.callbackUrl, input.formBody)
          : pending
            ? validateLoopbackCallbackUrl(pending, input.callbackUrl).pipe(
                Effect.map((url) => ({ method: "GET", url }) as const),
              )
            : validateUnadvertisedLoopbackCallbackUrl(input.callbackUrl).pipe(
                Effect.map((url) => ({ method: "GET", url }) as const),
              );
      const delivery = yield* validated.pipe(Effect.mapError((cause) => error(cause.detail)));
      launch.consumed = true;
      yield* forward(delivery).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            launch.consumed = false;
          }),
        ),
        Effect.mapError((cause) => error(cause.detail)),
      );
      forget(input);
    }),
    cancel: (input) => forget(input),
    clear: (terminal) => {
      const launches = byTerminal.get(key(terminal));
      byTerminal.delete(key(terminal));
      return Array.from(launches?.values() ?? [])
        .filter((launch) => !launch.consumed)
        .map((launch) => launch.captureId);
    },
  };
});

/**
 * A launch whose URL named no loopback listener can still end on one, for
 * example a tool that keeps its redirect target out of the query. Without an
 * advertised target, only the loopback origin rules can be checked.
 */
const validateUnadvertisedLoopbackCallbackUrl = Effect.fn(
  "validateUnadvertisedLoopbackCallbackUrl",
)(function* (callbackUrl: string): Effect.fn.Return<URL, AuthRelayError> {
  let callback: URL | null = null;
  try {
    callback = new URL(callbackUrl);
  } catch {
    callback = null;
  }
  const origin = callback ? parseLoopbackRedirectUri(`${callback.origin}/`) : null;
  if (
    callback === null ||
    origin === null ||
    callback.username !== "" ||
    callback.password !== "" ||
    callback.hash !== "" ||
    callbackUrl.length > BROWSER_LAUNCH_URL_MAX_LENGTH
  ) {
    return yield* new AuthRelayError({
      operation: "complete",
      detail: "Paste the full address of the final 127.0.0.1 or localhost page.",
    });
  }
  return callback;
});
