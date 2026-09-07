import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { hostAuthRelayBridge, releaseAuthRelayHostBridge } = vi.hoisted(() => ({
  hostAuthRelayBridge: vi.fn<() => Promise<{ hosted: boolean }>>(),
  releaseAuthRelayHostBridge: vi.fn<(hostId: string) => Promise<void>>(async () => undefined),
}));

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {
    hostAuthRelay: hostAuthRelayBridge,
    releaseAuthRelayHost: releaseAuthRelayHostBridge,
  },
}));

import {
  hostAuthRelay,
  readAuthRelayHosted,
  releaseAuthRelayHost,
  subscribeAuthRelayHosts,
  takeAuthRelayHost,
} from "./authRelayHosts";

const host = {
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make("thread-1"),
  terminalId: "terminal-1",
  captureId: "capture-1",
};
const NOW = Date.parse("2026-04-01T00:00:00.000Z");
const launch = { redirectUri: "http://localhost:47822/", expiresAt: "2026-04-01T00:05:00.000Z" };

describe("authRelayHosts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hostAuthRelayBridge.mockReset().mockResolvedValue({ hosted: true });
    releaseAuthRelayHostBridge.mockClear();
  });

  afterEach(() => {
    releaseAuthRelayHost(host.captureId);
    vi.useRealTimers();
  });

  it("hosts a capture once and reports the answer to subscribers", async () => {
    const changes = vi.fn();
    const unsubscribe = subscribeAuthRelayHosts(changes);
    hostAuthRelay(host, launch);
    hostAuthRelay(host, launch);

    expect(hostAuthRelayBridge).toHaveBeenCalledTimes(1);
    expect(hostAuthRelayBridge).toHaveBeenCalledWith({
      hostId: host.captureId,
      origin: "http://localhost:47822",
      path: "/",
    });
    expect(readAuthRelayHosted(host.captureId)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(readAuthRelayHosted(host.captureId)).toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("asks for nothing when the capture named no loopback listener", () => {
    hostAuthRelay(host, { ...launch, redirectUri: null });
    expect(hostAuthRelayBridge).not.toHaveBeenCalled();
    expect(readAuthRelayHosted(host.captureId)).toBeNull();
  });

  it("frees the port when the deadline for the capture passes", async () => {
    hostAuthRelay(host, launch);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(releaseAuthRelayHostBridge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(releaseAuthRelayHostBridge).toHaveBeenCalledWith(host.captureId);
    expect(readAuthRelayHosted(host.captureId)).toBeNull();
  });

  it("hands the registration to one delivery and keeps the port until released", async () => {
    hostAuthRelay(host, launch);
    await vi.advanceTimersByTimeAsync(0);

    expect(takeAuthRelayHost(host.captureId)).toEqual(host);
    expect(takeAuthRelayHost(host.captureId)).toBeUndefined();
    expect(releaseAuthRelayHostBridge).not.toHaveBeenCalled();
    // The expiry timer went with the registration; only the caller releases now.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(releaseAuthRelayHostBridge).not.toHaveBeenCalled();

    releaseAuthRelayHost(host.captureId);
    expect(releaseAuthRelayHostBridge).toHaveBeenCalledTimes(1);
  });

  it("treats a desktop that refused the port as unhosted", async () => {
    hostAuthRelayBridge.mockResolvedValue({ hosted: false });
    hostAuthRelay(host, launch);
    await vi.advanceTimersByTimeAsync(0);
    expect(readAuthRelayHosted(host.captureId)).toBe(false);
  });
});
