import type { TerminalBrowserLaunchResponseMode } from "@t3tools/contracts";

/**
 * How a terminal sign-in banner can carry the result back to the waiting
 * command:
 *
 * - `hosted`: the desktop stands in for the loopback listener on this machine,
 *   so the browser's return needs nothing from the user.
 * - `paste`: nobody is listening here, but the response rides in the return
 *   URL's query, so the user can paste that address.
 * - `unreachable`: the response is a form POST, which only a listener on the
 *   browser's own machine can catch. There is nothing to paste.
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
 * The launches the environment still accepts at `now`. The server forgets a
 * capture at `expiresAt`, so a banner shown past it can only fail; a launch
 * with an unreadable deadline stays, since the server would reject it anyway
 * with a message the user can act on. Returns the same array when nothing
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
