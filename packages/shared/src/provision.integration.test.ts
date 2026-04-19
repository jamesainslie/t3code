import { afterAll, describe, expect, it } from "vitest";
import { SshConnectionManager } from "./sshManager";
import { provision, teardown } from "./provision";

/**
 * Integration smoke test for the remote SSH provisioner.
 *
 * Requires a real SSH host. Set SSH_INTEGRATION_HOST=user@hostname to run.
 * The host must be reachable via SSH agent auth (no password).
 *
 * Optional env vars:
 *   T3_SERVER_BINARY  — path to a t3-server binary to upload (default: skip binary transfer)
 *   T3_TMUX_BINARY   — path to a static tmux binary to upload (default: skip binary transfer)
 */
const INTEGRATION_HOST = process.env["SSH_INTEGRATION_HOST"];
const TEST_PROJECT_ID = "integration-smoke-test-001";

describe.skipIf(!INTEGRATION_HOST)("provision — SSH integration", () => {
  const manager = new SshConnectionManager();
  // Track the localPort from the first provision so teardown can cancel the forward
  let firstLocalPort = 0;

  afterAll(async () => {
    if (INTEGRATION_HOST) {
      const [user = "root", host = ""] = INTEGRATION_HOST.includes("@")
        ? INTEGRATION_HOST.split("@")
        : ["root", INTEGRATION_HOST];

      await teardown({
        target: { host, user, port: 22 },
        projectId: TEST_PROJECT_ID,
        localPort: firstLocalPort,
      }).catch(() => {
        // best-effort cleanup — never throw from afterAll
      });
    }
    manager.closeAll();
  });

  it(
    "provisions and starts a server on the remote host",
    async () => {
      const [user = "root", host = ""] = INTEGRATION_HOST!.includes("@")
        ? INTEGRATION_HOST!.split("@")
        : ["root", INTEGRATION_HOST!];

      const statuses: string[] = [];

      const result = await provision({
        target: { host, user, port: 22 },
        projectId: TEST_PROJECT_ID,
        workspaceRoot: "/tmp/t3-integration-test",
        localVersion: "integration-test",
        serverBinaryPath: (platform, arch) =>
          process.env["T3_SERVER_BINARY"] ?? `/tmp/t3-server-${platform}-${arch}`,
        tmuxBinaryPath: (platform, arch) =>
          process.env["T3_TMUX_BINARY"] ?? `/tmp/tmux-${platform}-${arch}`,
        sshManager: manager,
        onStatus: (s) => statuses.push(s),
      });

      firstLocalPort = result.localPort;

      expect(result.remotePort).toBeGreaterThan(0);
      expect(result.localPort).toBeGreaterThan(0);
      expect(result.localPort).not.toBe(result.remotePort);
      expect(typeof result.authToken).toBe("string");
      expect(result.authToken.length).toBeGreaterThan(0);
      expect(statuses).toContain("provisioning");
      expect(statuses[statuses.length - 1]).toBe("connected");

      console.log(
        `Remote server running on port ${result.remotePort}, tunnelled to localhost:${result.localPort}`,
      );
    },
    30_000,
  );

  it(
    "reconnects to an existing session without re-provisioning",
    async () => {
      const [user = "root", host = ""] = INTEGRATION_HOST!.includes("@")
        ? INTEGRATION_HOST!.split("@")
        : ["root", INTEGRATION_HOST!];

      const statuses: string[] = [];

      const result = await provision({
        target: { host, user, port: 22 },
        projectId: TEST_PROJECT_ID,
        workspaceRoot: "/tmp/t3-integration-test",
        localVersion: "integration-test",
        serverBinaryPath: () => "/tmp/t3-server-unused",
        tmuxBinaryPath: () => "/tmp/tmux-unused",
        sshManager: manager,
        onStatus: (s) => statuses.push(s),
      });

      expect(result.remotePort).toBeGreaterThan(0);
      // The tmux session already exists — "starting" is skipped
      expect(statuses).not.toContain("starting");
      expect(statuses[statuses.length - 1]).toBe("connected");

      console.log(`Reconnected to existing session on port ${result.remotePort}`);
    },
    15_000,
  );
});
