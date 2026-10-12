import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { buildSshChildEnvironment, type SshAuthOptions } from "./auth.ts";
import { SshCommandError, SshInvalidTargetError } from "./errors.ts";
import { SshOutputObserver, type SshOutputSource } from "./output.ts";

const DEFAULT_SSH_COMMAND_TIMEOUT_MS = 60_000;
const SSH_COMMAND_KILL_GRACE_MS = 2_000;
const MAX_SSH_ERROR_OUTPUT_LENGTH = 4_000;

/**
 * ssh is a real executable everywhere (`ssh.exe` on Windows), so it is always
 * spawned directly — cmd.exe shell mode would re-tokenize arguments such as
 * identity-file paths containing spaces.
 */
const sshCommandForPlatform = (platform: NodeJS.Platform): string =>
  platform === "win32" ? "ssh.exe" : "ssh";

export const resolveSshCommand = Effect.map(HostProcess.Platform, sshCommandForPlatform);

const encoder = new TextEncoder();

export interface SshCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunSshCommandOptions extends SshAuthOptions {
  readonly preHostArgs?: ReadonlyArray<string>;
  readonly remoteCommandArgs?: ReadonlyArray<string>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  /** Pins how the command multiplexes; left out, ~/.ssh/config decides. */
  readonly multiplex?: SshMultiplex;
  /**
   * Report this command's output to the `SshOutputObserver` as it arrives. stderr only unless
   * `stdout` is set; never set it for a command whose stdout carries a credential.
   */
  readonly observe?: { readonly source: SshOutputSource; readonly stdout?: boolean };
  /** What the command is for, such as "launch" or "control-probe"; tags its span and failures. */
  readonly purpose?: string;
}

/**
 * Tags the current span with the target, so a trace can be filtered by host.
 * A plain effect rather than an `Effect.fn`, which would tag a span of its own.
 */
export const annotateSshTargetSpan = (
  target: DesktopSshEnvironmentTarget,
  extra?: Readonly<Record<string, unknown>>,
) =>
  Effect.annotateCurrentSpan({
    "ssh.alias": target.alias,
    "ssh.hostname": target.hostname,
    ...extra,
  });

export function parseSshResolveOutput(alias: string, stdout: string): DesktopSshEnvironmentTarget {
  const values = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const [key, ...rest] = trimmed.split(/\s+/u);
    if (!key || rest.length === 0 || values.has(key)) {
      continue;
    }
    values.set(key, rest.join(" ").trim());
  }

  const hostname = values.get("hostname")?.trim() || alias;
  const username = values.get("user")?.trim() || null;
  const rawPort = values.get("port")?.trim() ?? "";
  const parsedPort = Number.parseInt(rawPort, 10);

  return {
    alias,
    hostname,
    username,
    port: Number.isInteger(parsedPort) ? parsedPort : null,
  };
}

export function targetConnectionKey(target: DesktopSshEnvironmentTarget): string {
  return `${target.alias}\u0000${target.hostname}\u0000${target.username ?? ""}\u0000${target.port ?? ""}`;
}

/** Names the remote state directory for a target: the first 16 hex chars of its SHA-256 key. */
export const remoteStateKey = Effect.fn("ssh/command.remoteStateKey")(function* (
  target: DesktopSshEnvironmentTarget,
): Effect.fn.Return<string, never, Crypto.Crypto> {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto
    .digest("SHA-256", encoder.encode(targetConnectionKey(target)))
    .pipe(Effect.orDie);
  return Hex.encode(digest).slice(0, 16);
});

function buildSshHostSpec(target: DesktopSshEnvironmentTarget): string {
  const destination = target.alias.trim() || target.hostname.trim();
  if (destination.length === 0) {
    throw new Error("SSH target is missing its alias/hostname.");
  }
  return target.username ? `${target.username}@${destination}` : destination;
}

export const buildSshHostSpecEffect = (
  target: DesktopSshEnvironmentTarget,
): Effect.Effect<string, SshInvalidTargetError> =>
  Effect.try({
    try: () => buildSshHostSpec(target),
    catch: (cause) =>
      new SshInvalidTargetError({
        message: cause instanceof Error ? cause.message : "SSH target is invalid.",
      }),
  });

/**
 * How one ssh invocation multiplexes. Left out, ~/.ssh/config decides, which
 * suits callers such as device automation that benefit from a user master.
 * A chosen mode is pinned ahead of the host, where ssh keeps the first value
 * of an option, so ~/.ssh/config cannot route the command through a stale user
 * master: `direct` connects on its own, `client` rides an owned master's
 * socket, and `master` makes this invocation that owned master.
 */
export type SshMultiplex =
  | { readonly mode: "direct" }
  | { readonly mode: "client"; readonly socketPath: string }
  | { readonly mode: "master"; readonly socketPath: string };

export const SSH_DIRECT: SshMultiplex = { mode: "direct" };

function multiplexArgs(multiplex: SshMultiplex | undefined): string[] {
  switch (multiplex?.mode) {
    case undefined:
      return [];
    case "direct":
      return ["-o", "ControlMaster=no", "-o", "ControlPath=none"];
    case "client":
      return ["-o", "ControlMaster=no", "-o", `ControlPath=${multiplex.socketPath}`];
    case "master":
      return ["-o", "ControlMaster=yes", "-o", `ControlPath=${multiplex.socketPath}`];
  }
}

/** Options every ssh invocation starts with. */
export function baseSshArgs(
  target: DesktopSshEnvironmentTarget,
  input?: {
    readonly batchMode?: "yes" | "no";
    readonly multiplex?: SshMultiplex;
  },
): string[] {
  return [
    "-o",
    `BatchMode=${input?.batchMode ?? "no"}`,
    "-o",
    "ConnectTimeout=10",
    ...multiplexArgs(input?.multiplex),
    ...(target.port !== null ? ["-p", String(target.port)] : []),
  ];
}

export function getLastNonEmptyOutputLine(stdout: string): string | null {
  return (
    stdout
      .trim()
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .findLast((entry) => entry.length > 0) ?? null
  );
}

/** The whole stream as text; `onChunk` sees each decoded chunk as it arrives. */
export const collectProcessOutput = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  onChunk?: (text: string) => Effect.Effect<void>,
): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    onChunk === undefined ? (decoded) => decoded : Stream.tap(onChunk),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const TOKEN_KEYS = "access_token|bearerToken|credential|pairingToken|token";

/** Masks credentials in SSH output: JSON token fields and token parameters in URLs. */
export function redactSshOutput(output: string): string {
  return output
    .replace(new RegExp(`("(?:${TOKEN_KEYS})"\\s*:\\s*")[^"]+(")`, "giu"), "$1[redacted]$2")
    .replace(new RegExp(`([#?&](?:${TOKEN_KEYS})=)[^\\s&#"']+`, "giu"), "$1[redacted]");
}

function redactSshErrorOutput(output: string): string {
  const redacted = redactSshOutput(output);
  return redacted.length > MAX_SSH_ERROR_OUTPUT_LENGTH
    ? `${redacted.slice(0, MAX_SSH_ERROR_OUTPUT_LENGTH)}\n[truncated]`
    : redacted;
}

function normalizeSshErrorMessage(input: {
  readonly stdout?: string;
  readonly stderr: string;
  readonly fallbackMessage: string;
}): string {
  const cleanedStderr = input.stderr.trim();
  if (cleanedStderr.length > 0) {
    return cleanedStderr;
  }

  const cleanedStdout = input.stdout?.trim() ?? "";
  return cleanedStdout.length > 0 ? cleanedStdout : input.fallbackMessage;
}

function sshTargetLogFields(target: DesktopSshEnvironmentTarget) {
  return {
    alias: target.alias,
    hostname: target.hostname,
    username: target.username,
    port: target.port,
  };
}

function stdinStream(input: string | undefined) {
  return input === undefined ? Stream.empty : Stream.make(encoder.encode(input));
}

const runSshCommandInScope = Effect.fn("ssh/command.runSshCommand.inScope")(function* (
  target: DesktopSshEnvironmentTarget,
  input: RunSshCommandOptions,
  commandScope: Scope.Scope,
): Effect.fn.Return<
  SshCommandResult,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const hostSpec = yield* buildSshHostSpecEffect(target);
  const environment = yield* buildSshChildEnvironment({
    ...(input.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
    ...(input.authSecret === undefined ? {} : { authSecret: input.authSecret }),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SshCommandError({
          command: ["ssh"],
          exitCode: null,
          stderr: "",
          message: "Failed to prepare SSH authentication helpers.",
          cause,
        }),
    ),
  );
  const args = [
    ...baseSshArgs(target, {
      batchMode: input.batchMode ?? (input.interactiveAuth ? "no" : "yes"),
      ...(input.multiplex === undefined ? {} : { multiplex: input.multiplex }),
    }),
    ...(input.preHostArgs ?? []),
    hostSpec,
    ...(input.remoteCommandArgs ?? []),
  ];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sshCommand = yield* resolveSshCommand;
  yield* Effect.logDebug("ssh.command.start", {
    ...sshTargetLogFields(target),
    command: [sshCommand, ...args],
    hasStdin: input.stdin !== undefined,
    timeoutMs: input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS,
  });
  const child = yield* spawner
    .spawn(
      ChildProcess.make(sshCommand, args, {
        env: environment,
        extendEnv: true,
        // A timeout closes the command scope; an ssh that ignores SIGTERM must
        // not hold that close, and the caller's lock, open indefinitely.
        forceKillAfter: SSH_COMMAND_KILL_GRACE_MS,
        stdin: {
          stream: stdinStream(input.stdin),
          endOnDone: true,
        },
      }),
    )
    .pipe(
      Effect.provideService(Scope.Scope, commandScope),
      Effect.mapError(
        (cause) =>
          new SshCommandError({
            command: [sshCommand, ...args],
            exitCode: null,
            stderr: "",
            message:
              cause instanceof Error
                ? cause.message
                : `Failed to spawn SSH command for ${hostSpec}.`,
            cause,
          }),
      ),
    );

  const observer = yield* SshOutputObserver;
  const observe = input.observe;
  const report =
    observe === undefined
      ? () => undefined
      : (stream: "stdout" | "stderr") =>
          stream === "stdout" && observe.stdout !== true
            ? undefined
            : (text: string) => observer({ source: observe.source, stream, text });
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectProcessOutput(child.stdout, report("stdout")),
      collectProcessOutput(child.stderr, report("stderr")),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SshCommandError({
          command: ["ssh", ...args],
          exitCode: null,
          stderr: "",
          message:
            cause instanceof Error ? cause.message : `Failed to run SSH command for ${hostSpec}.`,
          cause,
        }),
    ),
  );

  if (exitCode !== 0) {
    const diagnosticStdout = redactSshErrorOutput(stdout);
    yield* Effect.logWarning("ssh.command.failed", {
      ...sshTargetLogFields(target),
      purpose: input.purpose ?? null,
      command: ["ssh", ...args],
      exitCode,
      stdout: diagnosticStdout,
      stderr,
    });
    return yield* new SshCommandError({
      command: ["ssh", ...args],
      exitCode,
      stdout: diagnosticStdout,
      stderr,
      message: normalizeSshErrorMessage({
        stdout: diagnosticStdout,
        stderr,
        fallbackMessage: `SSH command failed for ${hostSpec} (exit ${exitCode}).`,
      }),
    });
  }

  yield* Effect.logDebug("ssh.command.succeeded", {
    ...sshTargetLogFields(target),
    command: ["ssh", ...args],
  });
  return { stdout, stderr };
});

export const runSshCommand = Effect.fn("ssh/command.runSshCommand")(function* (
  target: DesktopSshEnvironmentTarget,
  input: RunSshCommandOptions = {},
): Effect.fn.Return<
  SshCommandResult,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  yield* annotateSshTargetSpan(
    target,
    input.purpose === undefined ? undefined : { "ssh.purpose": input.purpose },
  );
  return yield* Effect.scopedWith((commandScope) =>
    runSshCommandInScope(target, input, commandScope),
  ).pipe(
    Effect.timeoutOption(Duration.millis(input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS)),
    Effect.flatMap((result) =>
      Option.match(result, {
        onSome: Effect.succeed,
        onNone: () =>
          Effect.gen(function* () {
            yield* Effect.logWarning("ssh.command.timedOut", {
              ...sshTargetLogFields(target),
              purpose: input.purpose ?? null,
              timeoutMs: input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS,
              remoteCommandArgs: input.remoteCommandArgs ?? [],
              preHostArgs: input.preHostArgs ?? [],
              hasStdin: input.stdin !== undefined,
            });
            return yield* new SshCommandError({
              command: ["ssh"],
              exitCode: null,
              stderr: "",
              timedOut: true,
              message: `SSH command timed out after ${input.timeoutMs ?? DEFAULT_SSH_COMMAND_TIMEOUT_MS}ms.`,
            });
          }),
      }),
    ),
  );
});

export const resolveSshTarget = Effect.fn("ssh/command.resolveSshTarget")(function* (
  alias: string,
  options?: { readonly multiplex?: SshMultiplex },
): Effect.fn.Return<
  DesktopSshEnvironmentTarget,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const trimmedAlias = alias.trim();
  if (trimmedAlias.length === 0) {
    return yield* new SshInvalidTargetError({ message: "SSH host alias is required." });
  }

  yield* Effect.logDebug("ssh.target.resolve.start", { alias: trimmedAlias });
  return yield* runSshCommand(
    {
      alias: trimmedAlias,
      hostname: trimmedAlias,
      username: null,
      port: null,
    },
    {
      preHostArgs: ["-G"],
      purpose: "resolve",
      ...(options?.multiplex === undefined ? {} : { multiplex: options.multiplex }),
    },
  ).pipe(
    Effect.map((result) => parseSshResolveOutput(trimmedAlias, result.stdout)),
    Effect.tap((target) =>
      Effect.logDebug("ssh.target.resolve.succeeded", sshTargetLogFields(target)),
    ),
    Effect.catch((cause) =>
      Effect.logDebug("ssh.target.resolve.fallback", { alias: trimmedAlias, cause }).pipe(
        Effect.as({
          alias: trimmedAlias,
          hostname: trimmedAlias,
          username: null,
          port: null,
        }),
      ),
    ),
  );
});
