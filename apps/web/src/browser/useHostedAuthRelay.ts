import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  hostAuthRelay,
  readAuthRelayHosted,
  releaseAuthRelayHost,
  subscribeAuthRelayHosts,
} from "./authRelayHosts";

interface HostedAuthRelayInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly captureId: string;
  /** The loopback listener the capture advertised; without one there is no port to stand in for. */
  readonly redirectUri: string | null;
  readonly expiresAt: string;
}

/**
 * Has the desktop hold the loopback port of a pending sign-in and reports what
 * it said. The banner only starts the host; it never ends it, because the user
 * may well be signing in while this banner is off screen. Resolves to `null`
 * where hosting is unavailable (web, mobile, an older desktop build) and to
 * `false` when the port is already taken on this machine.
 */
export function useHostedAuthRelay(input: HostedAuthRelayInput): boolean | null {
  const { environmentId, threadId, terminalId, captureId, redirectUri, expiresAt } = input;
  useEffect(() => {
    hostAuthRelay({ environmentId, threadId, terminalId, captureId }, { redirectUri, expiresAt });
  }, [captureId, environmentId, expiresAt, redirectUri, terminalId, threadId]);
  return useSyncExternalStore(subscribeAuthRelayHosts, () => readAuthRelayHosted(captureId));
}

/**
 * Frees the port of any capture that left the pending list of an on-screen
 * terminal: settled from another client, dismissed here, or gone with the
 * process. Captures that settle while the terminal is off screen are released
 * by the delivery itself or by their deadline.
 */
export function useReleaseSettledAuthRelayHosts(
  launches: ReadonlyArray<{ readonly captureId: string }>,
): void {
  const previous = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const current = new Set(launches.map((launch) => launch.captureId));
    for (const captureId of previous.current) {
      if (!current.has(captureId)) releaseAuthRelayHost(captureId);
    }
    previous.current = current;
  }, [launches]);
}
