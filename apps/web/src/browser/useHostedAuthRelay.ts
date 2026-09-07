import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { previewBridge } from "~/components/preview/previewBridge";

import { forgetAuthRelayHost, registerAuthRelayHost } from "./authRelayHosts";

interface HostedAuthRelayInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly captureId: string;
  /** The loopback listener the capture advertised; without one there is no port to stand in for. */
  readonly redirectUri: string | null;
}

function loopbackTarget(redirectUri: string): { origin: string; path: string } | null {
  try {
    const url = new URL(redirectUri);
    return { origin: url.origin, path: url.pathname };
  } catch {
    return null;
  }
}

/**
 * Asks the desktop to hold the sign-in's loopback port for as long as the
 * banner is up, so the browser's return lands here instead of failing. Resolves
 * to `null` where hosting is unavailable (web, mobile, an older desktop build)
 * and to `false` when the port is already taken on this machine.
 */
export function useHostedAuthRelay(input: HostedAuthRelayInput): boolean | null {
  const { environmentId, threadId, terminalId, captureId, redirectUri } = input;
  const [hosted, setHosted] = useState<boolean | null>(null);
  useEffect(() => {
    const target = redirectUri === null ? null : loopbackTarget(redirectUri);
    if (!target) return;
    // Registered before the request so a return that beats its ack still lands.
    registerAuthRelayHost(captureId, { environmentId, threadId, terminalId, captureId });
    const request = previewBridge?.hostAuthRelay?.({
      hostId: captureId,
      origin: target.origin,
      path: target.path,
    });
    if (!request) {
      forgetAuthRelayHost(captureId);
      return;
    }
    let released = false;
    void request
      .then((result) => {
        if (!released) setHosted(result.hosted);
      })
      .catch(() => {
        if (!released) setHosted(false);
      });
    return () => {
      released = true;
      forgetAuthRelayHost(captureId);
      void previewBridge?.releaseAuthRelayHost?.(captureId).catch(() => {});
    };
  }, [captureId, environmentId, redirectUri, terminalId, threadId]);
  return hosted;
}
