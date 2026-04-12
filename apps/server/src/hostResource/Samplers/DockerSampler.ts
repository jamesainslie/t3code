import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";

function resolveSocketPath(): string {
  const dockerHost = process.env.DOCKER_HOST;
  if (dockerHost) {
    // Handle unix:// prefix
    if (dockerHost.startsWith("unix://")) {
      return dockerHost.slice("unix://".length);
    }
    return dockerHost;
  }
  return "/var/run/docker.sock";
}

interface DockerContainerJson {
  readonly State: string;
}

/**
 * Query Docker via its Unix socket using the containers/json endpoint.
 * Returns null if Docker is unavailable.
 */
export const sampleDocker: Effect.Effect<RawSample["containers"]> = Effect.tryPromise({
  try: async () => {
    const fs = await import("node:fs/promises");
    const http = await import("node:http");

    const socketPath = resolveSocketPath();

    // Check if socket exists before attempting connection
    try {
      await fs.access(socketPath);
    } catch {
      return null;
    }

    const response = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          path: "/v1.43/containers/json?all=true",
          method: "GET",
          timeout: 3_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer | string) => {
            data += chunk.toString();
          });
          res.on("end", () => resolve(data));
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Docker socket timeout"));
      });
      req.end();
    });

    const containers: readonly DockerContainerJson[] = JSON.parse(response);
    let running = 0;
    let stopped = 0;
    for (const c of containers) {
      if (c.State === "running") {
        running++;
      } else {
        stopped++;
      }
    }
    return { running, stopped, total: containers.length };
  },
  catch: () => null,
}).pipe(Effect.orElseSucceed(() => null));
