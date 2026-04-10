/**
 * RemoteEnv - Effect service contract for remote environment variable propagation.
 *
 * Provides access to runtime environment variables that may change across SSH
 * reconnects (e.g. SSH_AUTH_SOCK), reading from a watched env file when
 * configured.
 *
 * @module RemoteEnv
 */
import { Effect, ServiceMap } from "effect";

export interface RemoteEnvShape {
  /**
   * Returns the current SSH_AUTH_SOCK value.
   * Reads from the env file if configured, falls back to process.env.SSH_AUTH_SOCK.
   */
  readonly getSshAuthSock: () => Effect.Effect<string | undefined>;
}

/**
 * RemoteEnv - Service tag for remote environment variable propagation.
 */
export class RemoteEnv extends ServiceMap.Service<RemoteEnv, RemoteEnvShape>()(
  "t3/remote/Services/RemoteEnv",
) {}
