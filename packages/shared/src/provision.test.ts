import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { verifyTunnel } from "./provision.ts";

describe("verifyTunnel", () => {
  const servers: Server[] = [];

  afterEach(() => {
    while (servers.length > 0) {
      const s = servers.pop();
      s?.close();
    }
  });

  function listen(handler: (socket: import("node:net").Socket) => void): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer(handler);
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        servers.push(server);
        const addr = server.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("no port"));
      });
    });
  }

  it("resolves when the server writes any response bytes", async () => {
    const port = await listen((socket) => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
        socket.end();
      });
    });

    await expect(verifyTunnel(port, 2000)).resolves.toBeUndefined();
  });

  it("rejects when the server closes the socket without responding (stale-tunnel analogue)", async () => {
    const port = await listen((socket) => {
      // Accept the connection, never write, just close — mimics sshd receiving
      // RST from a dead forward target and tearing down the channel.
      socket.destroy();
    });

    await expect(verifyTunnel(port, 2000)).rejects.toThrow(/Tunnel probe/);
  });

  it("rejects when nothing is listening on the local port", async () => {
    // Grab a port, close the server so the port is free — now a connect
    // attempt should fail with ECONNREFUSED, which surfaces as a probe error.
    const port = await listen(() => {
      /* never called */
    });
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));

    await expect(verifyTunnel(port, 2000)).rejects.toThrow(/Tunnel probe/);
  });

  it("rejects on timeout when the server never responds or closes", async () => {
    const port = await listen((socket) => {
      // Hold the connection open indefinitely — simulates a tunnel that
      // accepts TCP but the remote side is hung.
      void socket;
    });

    await expect(verifyTunnel(port, 200)).rejects.toThrow(/timed out/);
  });
});
