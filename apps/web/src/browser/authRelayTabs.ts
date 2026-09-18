import type { DesktopPreviewAuthRelay, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { previewBridge } from "~/components/preview/previewBridge";

/**
 * Which pending sign-in an in-app browser tab was opened for. When the desktop
 * intercepts that tab's return to the environment's loopback listener, the
 * return URL goes to the same completion RPC the paste field uses.
 */
export type AuthRelayTag = {
  readonly kind: "terminal";
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly captureId: string;
  /** The listener the capture advertised, or null to accept any loopback origin. */
  readonly redirectUri: string | null;
};

const tags = new Map<string, AuthRelayTag>();

/** The loopback target the desktop should intercept for this tag. */
function authRelayTarget(tag: AuthRelayTag): DesktopPreviewAuthRelay {
  if (tag.redirectUri === null) return { origin: null, path: null };
  try {
    const url = new URL(tag.redirectUri);
    return { origin: url.origin, path: url.pathname };
  } catch {
    return { origin: null, path: null };
  }
}

/** Tags a freshly opened tab. Only the desktop can intercept, so the web build just remembers. */
export async function tagAuthRelayTab(tabId: string, tag: AuthRelayTag): Promise<void> {
  tags.set(tabId, tag);
  await previewBridge?.setAuthRelay?.(tabId, authRelayTarget(tag));
}

/** Consumes the tag: a relay tab returns once. */
export function takeAuthRelayTab(tabId: string): AuthRelayTag | undefined {
  const tag = tags.get(tabId);
  tags.delete(tabId);
  return tag;
}
