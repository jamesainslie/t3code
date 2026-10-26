import type { TerminalBrowserLaunchResponseMode } from "@lathe/contracts";

/**
 * How a terminal sign-in banner carries the result back to the waiting command. `hosted`: the
 * desktop stands in for the loopback listener, so the return needs nothing from the user. `paste`:
 * nobody listens here, but the response rides in the return URL's query for the user to paste.
 * `unreachable`: a form POST only a listener on the browser's own machine can catch.
 */
export type TerminalBrowserLaunchRelayMode = "hosted" | "paste" | "unreachable";

export interface TerminalBrowserLaunchRelayInput {
  /** Absent on captures from a server built before the field existed; treat as `query`. */
  readonly responseMode?: TerminalBrowserLaunchResponseMode | undefined;
  readonly redirectUri: string | null;
  /** `true` once the desktop confirmed it holds the port, `null` while pending or unavailable. */
  readonly hosted: boolean | null;
}

export function terminalBrowserLaunchRelayMode(
  input: TerminalBrowserLaunchRelayInput,
): TerminalBrowserLaunchRelayMode {
  if (input.hosted === true && input.redirectUri !== null) return "hosted";
  return input.responseMode === "form_post" ? "unreachable" : "paste";
}

/**
 * The launches the environment still accepts at `now`: the server forgets a capture at
 * `expiresAt`, so a later banner can only fail. A launch with an unreadable deadline stays, since
 * the server rejects it with a message the user can act on. Returns the same array when nothing
 * expired so memoized consumers do not re-render.
 */
export function pendingTerminalBrowserLaunches<T extends { readonly expiresAt: string }>(
  launches: ReadonlyArray<T>,
  now: number,
): ReadonlyArray<T> {
  const pending = launches.filter((launch) => {
    const expiresAt = Date.parse(launch.expiresAt);
    return Number.isNaN(expiresAt) || expiresAt > now;
  });
  return pending.length === launches.length ? launches : pending;
}

/** Milliseconds from `now` until the soonest launch expires, or null when none has a readable deadline. */
export function nextTerminalBrowserLaunchExpiry(
  launches: ReadonlyArray<{ readonly expiresAt: string }>,
  now: number,
): number | null {
  let soonest: number | null = null;
  for (const launch of launches) {
    const expiresAt = Date.parse(launch.expiresAt);
    if (Number.isNaN(expiresAt)) continue;
    if (soonest === null || expiresAt < soonest) soonest = expiresAt;
  }
  return soonest === null ? null : Math.max(0, soonest - now);
}
