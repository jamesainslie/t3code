/**
 * brokerClient — SSH connection lifecycle for remote projects.
 *
 * Desktop: delegates to Electron IPC via desktopBridge.
 * Web: connects to the local t3 broker at ws://127.0.0.1:3774.
 */

const BROKER_URL = "ws://127.0.0.1:3774";

export interface BrokerConnectOptions {
  projectId: string;
  host: string;
  user: string;
  port: number;
  workspaceRoot: string;
}

export interface BrokerConnectResult {
  wsUrl: string;
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktopBridge != null;
}

// ── Desktop path (Electron IPC) ───────────────────────────────────────

async function desktopConnect(opts: BrokerConnectOptions): Promise<BrokerConnectResult> {
  const result = await window.desktopBridge!.sshConnect(opts);
  return result;
}

async function desktopDisconnect(projectId: string): Promise<void> {
  await window.desktopBridge!.sshDisconnect(projectId);
}

// ── Web broker path (WebSocket to t3 broker) ──────────────────────────

class BrokerWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private connectPromise: Promise<void> | null = null;

  private ensureConnected(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(BROKER_URL);
      ws.onopen = () => {
        this.ws = ws;
        this.connectPromise = null;
        resolve();
      };
      ws.onerror = () => {
        this.connectPromise = null;
        reject(new Error("Cannot connect to t3 broker. Start it with: t3 broker"));
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        const msg = JSON.parse(e.data) as {
          id: string;
          error?: string;
          [k: string]: unknown;
        };
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg);
      };
      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        // Drain all in-flight RPCs so callers don't hang
        for (const [, p] of this.pending) {
          p.reject(new Error("Broker WebSocket closed unexpectedly"));
        }
        this.pending.clear();
      };
    });
    return this.connectPromise;
  }

  async send<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    await this.ensureConnected();
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.ws!.send(JSON.stringify({ id, method, ...payload }));
    });
  }
}

const brokerWsClient = new BrokerWsClient();

async function brokerConnect(opts: BrokerConnectOptions): Promise<BrokerConnectResult> {
  return brokerWsClient.send<BrokerConnectResult>(
    "broker.connect",
    opts as unknown as Record<string, unknown>,
  );
}

async function brokerDisconnect(projectId: string): Promise<void> {
  await brokerWsClient.send("broker.disconnect", { projectId });
}

// ── Public API ────────────────────────────────────────────────────────

export async function connectRemoteProject(
  opts: BrokerConnectOptions,
): Promise<BrokerConnectResult> {
  return isDesktop() ? desktopConnect(opts) : brokerConnect(opts);
}

export async function disconnectRemoteProject(projectId: string): Promise<void> {
  return isDesktop() ? desktopDisconnect(projectId) : brokerDisconnect(projectId);
}
