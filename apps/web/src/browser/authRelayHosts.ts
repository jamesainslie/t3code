import type { EnvironmentId, ThreadId } from "@lathe/contracts";

import { previewBridge } from "~/components/preview/previewBridge";

/**
 * The pending terminal sign-ins the desktop holds a loopback port for. Hosting follows the
 * capture, not the banner, so the port still answers after the user moves to another thread. A
 * host is released when its return is delivered, the capture leaves the terminal, or the
 * environment's deadline passes; the desktop caps hosts at six minutes so no port is orphaned.
 */
export type AuthRelayHost = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly captureId: string;
};

interface HostEntry {
  readonly host: AuthRelayHost;
  /** `true` once the desktop confirmed it holds the port, `false` when it could not, `null` while asked. */
  hosted: boolean | null;
  expiry: ReturnType<typeof setTimeout> | null;
}

/** setTimeout treats longer delays as zero; no capture lives anywhere near this. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const hosts = new Map<string, HostEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
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
 * Asks the desktop to stand in for the capture's loopback listener. Idempotent per capture, so a
 * remounted banner does not rebind or lose the answer. Does nothing where hosting is unavailable
 * (web, mobile, an older desktop build) or when the capture named no loopback listener.
 */
export function hostAuthRelay(
  host: AuthRelayHost,
  input: { readonly redirectUri: string | null; readonly expiresAt: string },
): void {
  if (hosts.has(host.captureId)) return;
  const target = input.redirectUri === null ? null : loopbackTarget(input.redirectUri);
  const request = target
    ? previewBridge?.hostAuthRelay?.({
        hostId: host.captureId,
        origin: target.origin,
        path: target.path,
      })
    : undefined;
  if (!request) return;
  const expiresIn = Date.parse(input.expiresAt) - Date.now();
  const entry: HostEntry = {
    host,
    hosted: null,
    expiry: Number.isNaN(expiresIn)
      ? null
      : setTimeout(
          () => releaseAuthRelayHost(host.captureId),
          Math.min(Math.max(0, expiresIn), MAX_TIMER_DELAY_MS),
        ),
  };
  // Registered before the desktop answers so a return that beats the ack still lands.
  hosts.set(host.captureId, entry);
  notify();
  const settle = (hosted: boolean) => {
    if (hosts.get(host.captureId) !== entry) return;
    entry.hosted = hosted;
    notify();
  };
  request.then((result) => settle(result.hosted)).catch(() => settle(false));
}

/** What the desktop said about the port: `null` until it answers or when nothing was asked. */
export function readAuthRelayHosted(captureId: string): boolean | null {
  return hosts.get(captureId)?.hosted ?? null;
}

export function subscribeAuthRelayHosts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Consumes the registration once the desktop delivered the browser's return:
 * a hosted listener answers one sign-in. The port itself stays bound until the
 * caller releases it after the completion RPC, so a reload of the return page
 * still gets a page rather than a refused connection.
 */
export function takeAuthRelayHost(hostId: string): AuthRelayHost | undefined {
  const entry = hosts.get(hostId);
  if (entry === undefined) return undefined;
  hosts.delete(hostId);
  if (entry.expiry !== null) clearTimeout(entry.expiry);
  notify();
  return entry.host;
}

/** Frees the port of a capture that settled, expired, or was taken. Safe to repeat. */
export function releaseAuthRelayHost(hostId: string): void {
  const entry = hosts.get(hostId);
  if (entry !== undefined) {
    hosts.delete(hostId);
    if (entry.expiry !== null) clearTimeout(entry.expiry);
    notify();
  }
  void previewBridge?.releaseAuthRelayHost?.(hostId).catch(() => {});
}
