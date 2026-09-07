import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

/**
 * Which pending sign-in the desktop is holding a loopback port for. Unlike a
 * tagged tab, a hosted listener catches the return from any browser on this
 * machine, including the form POST an in-app tab can never surface.
 */
type AuthRelayHost = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
  readonly captureId: string;
};

const hosts = new Map<string, AuthRelayHost>();

export function registerAuthRelayHost(hostId: string, host: AuthRelayHost): void {
  hosts.set(hostId, host);
}

/** Consumes the registration: a hosted listener returns once. */
export function takeAuthRelayHost(hostId: string): AuthRelayHost | undefined {
  const host = hosts.get(hostId);
  hosts.delete(hostId);
  return host;
}

/** Drops a registration whose capture settled or whose banner went away. */
export function forgetAuthRelayHost(hostId: string): void {
  hosts.delete(hostId);
}
