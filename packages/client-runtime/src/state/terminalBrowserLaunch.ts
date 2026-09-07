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
