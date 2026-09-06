// @effect-diagnostics nodeBuiltinImport:off - the helper talks to a private local socket, and the token is raw randomness with no Effect service in the terminal path.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import { HostProcessExecutablePath, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";

import { AuthRelayError } from "./AuthRelayError.ts";

/**
 * `BROWSER` capture for processes that run inside a PTY.
 *
 * A tool in a T3 terminal that opens a sign-in page inherits `BROWSER` from
 * the shell. The inline stderr helper in `browserLaunchCapture.ts` cannot be
 * used there: the helper's stderr is the terminal itself, and ConPTY on
 * Windows re-flows long lines, so nothing in-band survives every platform.
 * This helper instead connects to a private local socket owned by the
 * terminal manager and hands over its token and the URL. The token, issued
 * per terminal process, is the only thing the socket trusts.
 *
 * Two files live under the manager's directory: the Node helper and a
 * platform wrapper that sets `ELECTRON_RUN_AS_NODE`, because the desktop
 * strips that variable from terminal environments and the runtime may be
 * Electron. Only the wrapper path appears in `BROWSER`, shell-quoted, with
 * the token as its single argument; Python-style `%s` substitution and
 * appended-URL launchers both reach the helper the same way.
 */

export const BROWSER_LAUNCH_SOCKET_MAX_MESSAGE_BYTES = 20_480;
const SOCKET_IDLE_TIMEOUT_MS = 5_000;
const HELPER_FILE_NAME = "browser-launch.mjs";
const WRAPPER_FILE_NAME = "browser-launch";

export interface BrowserLaunchRegistration {
  /** The `BROWSER` value for the process whose launches should reach the handler. */
  readonly command: string;
  readonly release: Effect.Effect<void>;
}

export interface BrowserLaunchSocket {
  readonly address: string;
  readonly register: (
    onLaunch: (url: string) => Effect.Effect<void>,
  ) => Effect.Effect<BrowserLaunchRegistration>;
}

/** Wire format from the helper: token, newline, URL, newline. */
export function parseBrowserLaunchMessage(
  text: string,
): { readonly token: string; readonly url: string } | null {
  const first = text.indexOf("\n");
  if (first <= 0) return null;
  const second = text.indexOf("\n", first + 1);
  if (second === -1) return null;
  const token = text.slice(0, first);
  const url = text.slice(first + 1, second);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || url.length === 0 || /\s/.test(url)) return null;
  return { token, url };
}

export function browserLaunchSocketAddress(platform: NodeJS.Platform, directory: string): string {
  const digest = NodeCrypto.createHash("sha256").update(directory).digest("hex").slice(0, 16);
  return platform === "win32"
    ? `\\\\.\\pipe\\t3-browser-launch-${digest}`
    : `${NodeOS.tmpdir()}/t3-browser-launch-${digest}.sock`;
}

export function browserLaunchHelperScript(): string {
  return [
    'import net from "node:net";',
    "const [socketPath, token, ...rest] = process.argv.slice(2);",
    'const url = rest.filter((argument) => argument !== "%s").pop() ?? "";',
    "let done = false;",
    "const finish = (ok) => {",
    "  if (done) return;",
    "  done = true;",
    "  if (!ok && url) {",
    "    process.stderr.write(`T3 Code could not send this link to your client. Open it yourself:\\n${url}\\n`);",
    "  }",
    "  process.exit(0);",
    "};",
    "if (!socketPath || !token || !url) finish(false);",
    "const socket = net.connect(socketPath);",
    `socket.setTimeout(${SOCKET_IDLE_TIMEOUT_MS}, () => socket.destroy(new Error("timeout")));`,
    'socket.on("error", () => finish(false));',
    'socket.on("connect", () => socket.write(`${token}\\n${url}\\n`));',
    'let reply = "";',
    'socket.on("data", (chunk) => { reply += chunk.toString(); });',
    'socket.on("close", () => finish(reply.startsWith("ok")));',
    "",
  ].join("\n");
}

function quotePosixDoubleQuoted(value: string): string {
  return `"${value.replaceAll(/["\\$`]/g, (character) => `\\${character}`)}"`;
}

export function browserLaunchWrapperScript(input: {
  readonly platform: NodeJS.Platform;
  readonly runtimeExecutablePath: string;
  readonly helperPath: string;
  readonly address: string;
}): string {
  if (input.platform === "win32") {
    return [
      "@echo off",
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${input.runtimeExecutablePath}" "${input.helperPath}" "${input.address}" %*`,
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    `ELECTRON_RUN_AS_NODE=1 exec ${quotePosixDoubleQuoted(input.runtimeExecutablePath)} ${quotePosixDoubleQuoted(input.helperPath)} ${quotePosixDoubleQuoted(input.address)} "$@"`,
    "",
  ].join("\n");
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Writes the helper files under `directory`, listens on the private socket
 * for the rest of the scope, and issues per-process tokens. Fails when the
 * wrapper path could not survive Python's `BROWSER` splitting; callers then
 * run terminals without capture rather than with a broken one.
 */
export const makeBrowserLaunchSocket = Effect.fn("makeBrowserLaunchSocket")(function* (input: {
  readonly directory: string;
  readonly address?: string;
  readonly runtimeExecutablePath?: string;
  readonly platform?: NodeJS.Platform;
}): Effect.fn.Return<
  BrowserLaunchSocket,
  AuthRelayError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = input.platform ?? (yield* HostProcessPlatform);
  const runtimeExecutablePath = input.runtimeExecutablePath ?? (yield* HostProcessExecutablePath);
  const failed = (detail: string, cause?: unknown) =>
    new AuthRelayError({ operation: "browser", detail, cause });
  const address = input.address ?? browserLaunchSocketAddress(platform, input.directory);
  const helperPath = path.join(input.directory, HELPER_FILE_NAME);
  const wrapperPath = path.join(
    input.directory,
    platform === "win32" ? `${WRAPPER_FILE_NAME}.cmd` : WRAPPER_FILE_NAME,
  );
  const browserPath = platform === "win32" ? wrapperPath.replaceAll("\\", "/") : wrapperPath;
  if (
    browserPath.includes(platform === "win32" ? ";" : ":") ||
    /[\r\n\0]/.test(browserPath) ||
    browserPath.includes("%s")
  ) {
    return yield* failed("The T3 data directory cannot host a BROWSER helper.");
  }

  yield* fs
    .makeDirectory(input.directory, { recursive: true, mode: 0o700 })
    .pipe(
      Effect.mapError((cause) => failed("Could not create the browser helper directory.", cause)),
    );
  yield* fs
    .writeFileString(helperPath, browserLaunchHelperScript())
    .pipe(Effect.mapError((cause) => failed("Could not write the browser helper.", cause)));
  yield* fs
    .writeFileString(
      wrapperPath,
      browserLaunchWrapperScript({ platform, runtimeExecutablePath, helperPath, address }),
    )
    .pipe(Effect.mapError((cause) => failed("Could not write the browser helper wrapper.", cause)));
  if (platform !== "win32") {
    yield* fs
      .chmod(wrapperPath, 0o700)
      .pipe(
        Effect.mapError((cause) => failed("Could not mark the browser helper executable.", cause)),
      );
    // A socket file left by a previous server on this directory would refuse the bind.
    yield* fs.remove(address).pipe(Effect.ignore);
  }

  const handlers = new Map<string, (url: string) => Effect.Effect<void>>();
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const server = NodeNet.createServer((socket) => {
    let received = "";
    let settled = false;
    const reply = (text: string) => {
      if (settled) return;
      settled = true;
      socket.end(text);
    };
    socket.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      if (received.length > BROWSER_LAUNCH_SOCKET_MAX_MESSAGE_BYTES) {
        socket.destroy();
        return;
      }
      const message = parseBrowserLaunchMessage(received);
      if (!message) return;
      const handler = handlers.get(message.token);
      if (!handler) {
        reply("unknown\n");
        return;
      }
      runFork(handler(message.url).pipe(Effect.ignoreCause({ log: true })));
      reply("ok\n");
    });
  });
  yield* Effect.callback<void, AuthRelayError>((resume) => {
    server.once("error", (cause) =>
      resume(Effect.fail(failed("Could not listen for browser launches.", cause))),
    );
    server.listen(address, () => resume(Effect.void));
  });
  if (platform !== "win32") {
    yield* fs.chmod(address, 0o600).pipe(Effect.ignore);
  }
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      handlers.clear();
      yield* Effect.callback<void>((resume) => {
        server.close(() => resume(Effect.void));
      });
      if (platform !== "win32") yield* fs.remove(address).pipe(Effect.ignore);
    }),
  );

  return {
    address,
    register: (onLaunch) =>
      Effect.sync(() => {
        const token = NodeCrypto.randomBytes(24).toString("base64url");
        handlers.set(token, onLaunch);
        return {
          command: `${quoteShellArgument(browserPath)} ${quoteShellArgument(token)}`,
          release: Effect.sync(() => {
            handlers.delete(token);
          }),
        };
      }),
  };
});
