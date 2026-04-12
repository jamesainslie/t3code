import * as FS from "node:fs/promises";
import { Effect, Layer } from "effect";
import { ServerConfig } from "../../config.ts";
import { RemoteEnv, type RemoteEnvShape } from "../Services/RemoteEnv.ts";

const makeRemoteEnv = Effect.gen(function* () {
  const config = yield* ServerConfig;

  const getSshAuthSock: RemoteEnvShape["getSshAuthSock"] = () =>
    Effect.gen(function* () {
      // If an env file is configured (set via --env-file flag for headless mode),
      // read SSH_AUTH_SOCK from it. This handles the tmux socket staleness problem.
      if (config.envFile) {
        const content = yield* Effect.tryPromise({
          try: () => FS.readFile(config.envFile!, "utf8"),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined));
        if (content) {
          const match = content.match(/^SSH_AUTH_SOCK=(.+)$/m);
          if (match?.[1]) return match[1];
        }
      }
      // Fall back to current process environment
      return process.env.SSH_AUTH_SOCK;
    });

  return { getSshAuthSock } satisfies RemoteEnvShape;
});

export const RemoteEnvLive = Layer.effect(RemoteEnv, makeRemoteEnv);
