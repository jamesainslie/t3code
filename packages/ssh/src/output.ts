import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Which step of bringing up an SSH environment produced the output. */
export type SshOutputSource = "launch" | "tunnel" | "remote-log";

export interface SshOutputChunk {
  readonly source: SshOutputSource;
  readonly stream: "stdout" | "stderr";
  /** Decoded text as it arrived; chunks can split lines and are not redacted. */
  readonly text: string;
}

export type SshOutputObserverFn = (chunk: SshOutputChunk) => Effect.Effect<void>;

/**
 * Receives SSH output while it arrives, so a caller can show what a connection
 * attempt is doing, including a command that later times out. Only commands
 * that opt in through `observe` report anything; the default discards it.
 */
export const SshOutputObserver = Context.Reference<SshOutputObserverFn>(
  "@t3tools/ssh/SshOutputObserver",
  { defaultValue: () => () => Effect.void },
);
