/**
 * BrokerServer — local SSH connection broker for web browser clients.
 *
 * Browsers cannot spawn SSH processes. This broker listens on ws://127.0.0.1:3774
 * and manages SSH subprocesses on behalf of connected browser clients.
 *
 * JSON-RPC style protocol:
 *   Request:  { id: string; method: string; ...params }
 *   Response: { id: string; ...result } | { id: string; error: string }
 *   Status:   { id: string; _status: string }  (interim progress notification)
 *
 * Methods:
 *   broker.connect    → provision() → { wsUrl, authToken }
 *   broker.disconnect → teardown()  → { ok: true }
 *   broker.status     → { connections: { projectId, wsUrl }[] }
 *   broker.cleanup    → { ok: true } (best-effort session cleanup)
 *
 * @module BrokerServer
 */
import { SshConnectionManager } from "@t3tools/shared/sshManager";
import { provision, teardown } from "../remote/Provisioner.ts";
import type { SshTarget } from "@t3tools/shared/ssh";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrokerOptions {
  port?: number | undefined;
  host?: string | undefined;
}

interface ActiveConnection {
  target: SshTarget;
  localPort: number;
  wsUrl: string;
  authToken: string;
}

interface BrokerRequest {
  id: string;
  method: string;
  [key: string]: unknown;
}

interface ConnectParams extends BrokerRequest {
  projectId: string;
  host: string;
  user: string;
  port?: number;
  workspaceRoot: string;
}

interface DisconnectParams extends BrokerRequest {
  projectId: string;
}

// ── Broker ───────────────────────────────────────────────────────────────────

/**
 * Runs the local SSH connection broker. Never resolves — runs until the
 * process exits. Bind to 127.0.0.1 (loopback only) to avoid exposure.
 */
export async function runBroker(opts: BrokerOptions = {}): Promise<never> {
  const port = opts.port ?? 3774;
  const host = opts.host ?? "127.0.0.1";

  const sshManager = new SshConnectionManager();
  const activeConnections = new Map<string, ActiveConnection>();

  if (typeof Bun !== "undefined") {
    return runBrokerBun({ host, port, sshManager, activeConnections });
  }
  return runBrokerNode({ host, port, sshManager, activeConnections });
}

// ── Bun implementation ───────────────────────────────────────────────────────

interface BrokerContext {
  host: string;
  port: number;
  sshManager: SshConnectionManager;
  activeConnections: Map<string, ActiveConnection>;
}

async function runBrokerBun(ctx: BrokerContext): Promise<never> {
  const { host, port, sshManager, activeConnections } = ctx;

  Bun.serve({
    hostname: host,
    port,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Use WebSocket", { status: 426 });
    },
    websocket: {
      async message(ws, rawData) {
        const text = typeof rawData === "string" ? rawData : rawData.toString();
        let msg: BrokerRequest;
        try {
          msg = JSON.parse(text) as BrokerRequest;
        } catch {
          return;
        }
        const reply = (payload: Record<string, unknown>) => {
          ws.send(JSON.stringify({ id: msg.id, ...payload }));
        };
        await handleMessage(msg, reply, sshManager, activeConnections);
      },
    },
  });

  console.log(`[t3 broker] listening on ws://${host}:${port}`);
  return new Promise<never>(() => {});
}

// ── Node implementation ──────────────────────────────────────────────────────

// The broker requires Bun's native WebSocket server. The t3 server is
// distributed as a Bun binary, so this path should never be reached in
// production. In development under Node, use `bun run` instead.
async function runBrokerNode(_ctx: BrokerContext): Promise<never> {
  throw new Error(
    "[t3 broker] Running under Node.js is not supported. " +
      "Use `bun run` to start the broker, or build with Bun.",
  );
}

// ── Message dispatch ─────────────────────────────────────────────────────────

async function handleMessage(
  msg: BrokerRequest,
  reply: (payload: Record<string, unknown>) => void,
  sshManager: SshConnectionManager,
  activeConnections: Map<string, ActiveConnection>,
): Promise<void> {
  try {
    switch (msg.method) {
      case "broker.connect": {
        const {
          projectId,
          host: sshHost,
          user,
          port: sshPort = 22,
          workspaceRoot,
        } = msg as ConnectParams;

        if (!projectId || !sshHost || !user || !workspaceRoot) {
          reply({ error: "broker.connect requires: projectId, host, user, workspaceRoot" });
          return;
        }

        const target: SshTarget = { host: sshHost, user, port: sshPort };

        const result = await provision({
          target,
          projectId,
          workspaceRoot,
          localVersion: process.env.T3_VERSION ?? "dev",
          serverBinaryPath: (platform, arch) => `t3-server-${platform}-${arch}`,
          tmuxBinaryPath: (platform, arch) => `tmux-${platform}-${arch}`,
          sshManager,
          onStatus: (phase) => {
            reply({ _status: phase });
          },
        });

        const wsUrl = `ws://127.0.0.1:${result.localPort}`;
        activeConnections.set(projectId, {
          target,
          localPort: result.localPort,
          wsUrl,
          authToken: result.authToken,
        });

        reply({ wsUrl, authToken: result.authToken });
        break;
      }

      case "broker.disconnect": {
        const { projectId } = msg as DisconnectParams;
        if (!projectId) {
          reply({ error: "broker.disconnect requires: projectId" });
          return;
        }
        const conn = activeConnections.get(projectId);
        if (conn) {
          activeConnections.delete(projectId);
          // best-effort teardown — do not block the reply
          teardown({ target: conn.target, projectId, localPort: conn.localPort }).catch(() => {});
        }
        reply({ ok: true });
        break;
      }

      case "broker.status": {
        const connections = [...activeConnections.entries()].map(([projectId, conn]) => ({
          projectId,
          wsUrl: conn.wsUrl,
        }));
        reply({ connections });
        break;
      }

      case "broker.cleanup": {
        const { projectId } = msg as DisconnectParams;
        if (!projectId) {
          reply({ error: "broker.cleanup requires: projectId" });
          return;
        }
        const conn = activeConnections.get(projectId);
        if (conn) {
          activeConnections.delete(projectId);
          teardown({ target: conn.target, projectId, localPort: conn.localPort }).catch(() => {});
        }
        reply({ ok: true });
        break;
      }

      default:
        reply({ error: `Unknown method: ${String(msg.method)}` });
    }
  } catch (err) {
    reply({ error: String(err) });
  }
}
