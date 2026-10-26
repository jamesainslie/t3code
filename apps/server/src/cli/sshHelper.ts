import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/cli";

import { runPickPort, runRuntimePort, runWaitReady } from "./sshHelperFastPath.ts";

/**
 * Helpers the SSH launch script runs on the remote host. Its exact argument shapes take the
 * bin.ts fast path in ./sshHelperFastPath.ts; these definitions keep malformed arguments and
 * programmatic CLI use wired to the same functions.
 */

const pickPort = Command.make("pick-port", {
  portFile: Argument.String("port-file"),
  defaultPort: Argument.Int("default-port"),
  scanWindow: Argument.Int("scan-window"),
}).pipe(
  Command.withHandler(({ portFile, defaultPort, scanWindow }) =>
    Effect.promise(() => runPickPort(portFile, defaultPort, scanWindow)),
  ),
);

/** Exits 0 once the loopback server answers, 1 when the deadline passes first. */
const waitReady = Command.make("wait-ready", {
  port: Argument.Int("port"),
  timeoutMs: Argument.Int("timeout-ms"),
  probeTimeoutMs: Argument.Int("probe-timeout-ms"),
}).pipe(
  Command.withHandler(({ port, timeoutMs, probeTimeoutMs }) =>
    Effect.promise(() => runWaitReady(port, timeoutMs, probeTimeoutMs)),
  ),
);

/** Prints `<pid> <port>` for a live default-home server, or exits 1. */
const runtimePort = Command.make("runtime-port", {
  runtimeFile: Argument.String("runtime-file"),
}).pipe(Command.withHandler(({ runtimeFile }) => Effect.sync(() => runRuntimePort(runtimeFile))));

export const sshHelperCommand = Command.make("__ssh-helper").pipe(
  Command.unlisted,
  Command.withSubcommands([pickPort, waitReady, runtimePort]),
);
