import { HostProcessExecutablePath, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import { AuthRelayError } from "./AuthRelayError.ts";

/**
 * `BROWSER` hijack for tools that open a sign-in page from the environment.
 *
 * The user is never at the environment, so a browser there is always wrong.
 * Instead `BROWSER` points at a tiny helper that writes the URL it was asked
 * to open to its stderr behind a marker, then exits successfully so the tool
 * believes the browser opened and keeps waiting for its callback. The process
 * that spawned the tool reads the marker line and relays the URL to the
 * client that owns the flow.
 */

export const BROWSER_LAUNCH_URL_MAX_LENGTH = 16_384;
const PREFLIGHT_TIMEOUT = "5 seconds";
const PREFLIGHT_URL = "https://example.invalid/t3-browser-launch-preflight";
const MAX_MARKER_LINE_LENGTH = 128 + BROWSER_LAUNCH_URL_MAX_LENGTH + 2;
const decodeHelperUrl = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.String));

export interface BrowserLaunchCommand {
  readonly marker: string;
  /** Helper executable, as the spawner and the tool's shell see it. */
  readonly executable: string;
  /** Helper arguments up to the URL. Python substitutes `%s`; other tools append the URL. */
  readonly args: ReadonlyArray<string>;
  /** The `BROWSER` value: the executable and arguments, shell-quoted. */
  readonly command: string;
}

/**
 * Python splits `BROWSER` on the platform path separator before it parses
 * quotes, so the source keeps clear of both colons and semicolons. EPIPE
 * must still exit 0 so Python does not fall back to an OS browser after
 * cancellation. Python replaces `%s` with the URL; Go and shell tools append
 * it instead, so the helper reports the last argument that is not the
 * literal placeholder.
 */
export function browserLaunchHelperSource(marker: string): string {
  return (
    `process.stderr.on("error",()=>process.exit(0)).write(` +
    `"${marker}"+JSON.stringify(process.argv.filter((a)=>a!=="%s").pop()||"")+"\\n",` +
    `()=>process.exit(0))`
  );
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Builds the `BROWSER` value that runs the inline helper through the T3
 * runtime (Node, or Electron with `ELECTRON_RUN_AS_NODE`). Fails when the
 * runtime path cannot survive Python's `BROWSER` splitting.
 */
export const buildBrowserLaunchCommand = Effect.fn("buildBrowserLaunchCommand")(function* (input: {
  readonly marker: string;
  readonly runtimeExecutablePath?: string;
  readonly platform?: NodeJS.Platform;
}): Effect.fn.Return<BrowserLaunchCommand, AuthRelayError> {
  const platform = input.platform ?? (yield* HostProcessPlatform);
  const runtimeExecutablePath = input.runtimeExecutablePath ?? (yield* HostProcessExecutablePath);
  const executable =
    platform === "win32" ? runtimeExecutablePath.replaceAll("\\", "/") : runtimeExecutablePath;
  if (/[:;\s"'\\]/.test(input.marker)) {
    return yield* new AuthRelayError({
      operation: "browser",
      detail: "The browser launch marker cannot be used in a BROWSER command.",
    });
  }
  const args = ["-e", browserLaunchHelperSource(input.marker), "--", "%s"];
  const command = [executable, ...args].map(quoteShellArgument).join(" ");
  if (
    command.includes(platform === "win32" ? ";" : ":") ||
    executable.includes("\r") ||
    executable.includes("\n") ||
    executable.includes("\0") ||
    executable.includes("%s")
  ) {
    return yield* new AuthRelayError({
      operation: "browser",
      detail: "The T3 runtime path cannot be used to suppress browser launches.",
    });
  }
  return { marker: input.marker, executable, args, command };
});

/**
 * Runs the helper once with a fake URL and checks that it reports exactly
 * that URL and nothing else. A runtime that cannot run the helper would let
 * the tool fall back to an OS browser, so the flow refuses to start.
 */
export const preflightBrowserLaunchCommand = Effect.fn("preflightBrowserLaunchCommand")(function* (
  command: BrowserLaunchCommand,
  env: NodeJS.ProcessEnv,
): Effect.fn.Return<void, AuthRelayError, ChildProcessSpawner.ChildProcessSpawner> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const unverified = (detail: string) => new AuthRelayError({ operation: "browser", detail });
  const args = command.args.map((argument) => (argument === "%s" ? PREFLIGHT_URL : argument));
  yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(command.executable, args, { env, extendEnv: false, shell: false }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 4_096 }),
        collectUint8StreamText({ stream: child.stderr, maxBytes: 4_096 }),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    if (
      Number(exitCode) !== 0 ||
      stdout.bytes !== 0 ||
      stdout.truncated ||
      stderr.truncated ||
      stderr.text !== `${command.marker}"${PREFLIGHT_URL}"\n`
    ) {
      return yield* unverified("The browser launch helper could not be verified.");
    }
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: PREFLIGHT_TIMEOUT,
      orElse: () => Effect.fail(unverified("The browser launch helper verification timed out.")),
    }),
    Effect.mapError((error) =>
      error._tag === "AuthRelayError"
        ? error
        : unverified("The browser launch helper could not be verified."),
    ),
  );
});

/**
 * Consumes a tool's stderr text and hands every helper-reported URL to
 * `onUrl`. Text is buffered across chunks, so a marker line may arrive in
 * pieces. Lines that are not marker lines, and marker lines that do not
 * decode, are dropped without logging: stderr can carry anything. Failures
 * from `onUrl` propagate so the flow owner can stop the process.
 *
 * `readLine` lets a caller recognize an extra native line format that also
 * carries the URL; it returns the URL for such a line, or `undefined`.
 */
export function makeBrowserLaunchStderrHandler<E>(input: {
  readonly marker: string;
  readonly onUrl: (url: string) => Effect.Effect<void, E>;
  readonly readLine?: (line: string) => string | undefined;
}): (text: string) => Effect.Effect<void, E> {
  let pending = "";
  const handleLine = (line: string): Effect.Effect<void, E> => {
    const message = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (message.length > MAX_MARKER_LINE_LENGTH) return Effect.void;
    const native = input.readLine?.(message);
    const url: Effect.Effect<string, Schema.SchemaError> | undefined =
      native !== undefined
        ? Effect.succeed(native)
        : message.startsWith(input.marker)
          ? decodeHelperUrl(message.slice(input.marker.length))
          : undefined;
    if (url === undefined) return Effect.void;
    return url.pipe(
      Effect.matchEffect({
        onFailure: () => Effect.void,
        onSuccess: (value) =>
          value.length > BROWSER_LAUNCH_URL_MAX_LENGTH ? Effect.void : input.onUrl(value),
      }),
    );
  };
  return Effect.fn("browserLaunchCapture.handleStderr")(function* (text: string) {
    const lines = `${pending}${text}`.split("\n");
    pending = lines.pop() ?? "";
    if (pending.length > MAX_MARKER_LINE_LENGTH) pending = "";
    yield* Effect.forEach(lines, handleLine, { discard: true });
  });
}
