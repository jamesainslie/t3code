import type { DesktopSshEnvironmentTarget } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as SshAuth from "./auth.ts";
import {
  annotateSshTargetSpan,
  baseSshArgs,
  buildSshHostSpecEffect,
  collectProcessOutput,
  remoteStateKey,
  resolveSshCommand,
  runSshCommand,
} from "./command.ts";
import { SshCommandError, type SshInvalidTargetError } from "./errors.ts";

const MASTER_READY_TIMEOUT_MS = 30_000;
const MASTER_READY_POLL_MS = 100;
const MASTER_PROBE_TIMEOUT_MS = 5_000;
const MASTER_KILL_GRACE_MS = 2_000;
const MAX_MASTER_STDERR_LENGTH = 4_000;
// OpenSSH binds the master at `<ControlPath>.<16 random chars>` and links it
// into place, so that longer name and its NUL must fit sun_path.
const OPENSSH_BIND_SUFFIX_BYTES = 17;

const encoder = new TextEncoder();

/**
 * stderr that means a command went through a master that no longer serves it.
 * A dead master's socket refuses quietly and ssh connects directly instead, so
 * only a master that accepted and then failed shows up here.
 */
const MUX_FAILURE_PATTERN = /read from master failed|mux_client_|muxclient|master is not running/iu;

export function isMuxFailure(error: unknown): boolean {
  return (
    error instanceof SshCommandError &&
    !error.timedOut &&
    MUX_FAILURE_PATTERN.test(`${error.stderr}\n${error.message}`)
  );
}

function sunPathBytes(platform: NodeJS.Platform): number {
  return platform === "linux" ? 108 : 104;
}

/**
 * Where a target's master listens: `<directory>/<state key>.sock`, or null when
 * that path would not fit a unix socket address or the platform has no masters.
 * Win32-OpenSSH accepts the Control options but never creates a master.
 */
export function controlSocketPath(input: {
  readonly directory: string;
  readonly stateKey: string;
  readonly platform: NodeJS.Platform;
}): string | null {
  if (input.platform === "win32") {
    return null;
  }
  const socketPath = `${input.directory.replace(/\/+$/u, "")}/${input.stateKey}.sock`;
  const bytes = encoder.encode(socketPath).length + OPENSSH_BIND_SUFFIX_BYTES + 1;
  return bytes <= sunPathBytes(input.platform) ? socketPath : null;
}

type ControlMasterContext =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path;

interface OwnedMaster {
  readonly socketPath: string;
  readonly process: ChildProcessSpawner.ChildProcessHandle;
  /** Closing it kills the master and removes its socket. */
  readonly scope: Scope.Closeable;
}

/**
 * How `acquire` found a target's master: kept a healthy one, started one,
 * gave up on masters for this target (`reason` says why), or has none to give
 * because no socket directory was configured or the platform has no masters.
 */
export type ControlMasterOutcome =
  | { readonly socketPath: string; readonly decision: "reused" | "created" }
  | { readonly socketPath: null; readonly decision: "disabled" }
  | { readonly socketPath: null; readonly decision: "unavailable"; readonly reason: string };

interface ControlMasterRequest<E, R> {
  readonly key: string;
  readonly target: DesktopSshEnvironmentTarget;
  /** Runs `start` with the target's credentials, prompting and retrying like any command. */
  readonly authenticate: (
    start: (
      authOptions: SshAuth.SshAuthOptions,
    ) => Effect.Effect<void, SshCommandError | SshInvalidTargetError, ControlMasterContext>,
  ) => Effect.Effect<void, E, R>;
}

/**
 * One owned ssh ControlMaster per target, so one-shot commands share a
 * connection whose health Lathe checks itself instead of trusting whatever
 * ~/.ssh/config set up. Callers hold the target's lock around every call.
 *
 * The master is a foreground `ssh -N` child: `ControlPersist` would make ssh
 * fork into the background after authenticating, leaving a master no process
 * handle owns. A master left by a crash is told to exit on the next start.
 */
export const make = Effect.fn("ssh/controlMaster.make")(function* (options: {
  readonly directory: string | undefined;
}): Effect.fn.Return<
  {
    /** The socket for the target's one-shots, starting a master if needed; null runs them directly. */
    readonly acquire: <E extends { readonly _tag: string }, R>(
      request: ControlMasterRequest<E, R>,
    ) => Effect.Effect<ControlMasterOutcome, E, R | ControlMasterContext>;
    /** The socket of a master that answers a round trip; never starts one. */
    readonly reuse: (
      key: string,
      target: DesktopSshEnvironmentTarget,
    ) => Effect.Effect<string | null, never, ControlMasterContext>;
    /** Stops the target's master, if any; the next acquire starts a new one. */
    readonly close: (key: string) => Effect.Effect<void>;
  },
  never,
  Scope.Scope
> {
  const managerScope = yield* Scope.Scope;
  const masters = new Map<string, OwnedMaster>();
  // Targets whose master failed for a reason other than authentication, with
  // that reason. They stay on direct connections for the manager's lifetime.
  const unavailable = new Map<string, string>();
  let removeFallbackDirectory: Effect.Effect<void> = Effect.void;

  const close = (key: string) =>
    Effect.suspend(() => {
      const master = masters.get(key);
      if (master === undefined) {
        return Effect.void;
      }
      masters.delete(key);
      return Scope.close(master.scope, Exit.void);
    }).pipe(Effect.uninterruptible);

  yield* Scope.addFinalizer(
    managerScope,
    Effect.suspend(() =>
      Effect.forEach([...masters.keys()], close, { concurrency: "unbounded", discard: true }),
    ).pipe(Effect.andThen(Effect.suspend(() => removeFallbackDirectory))),
  );

  // A home directory too deep for a socket address falls back to one private
  // temporary directory per manager. mkdtemp creates it 0700 with a random
  // name, so no other user can plant a socket there.
  const fallbackDirectory = yield* Effect.cached(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectory({ prefix: "t3ssh-" });
      removeFallbackDirectory = fs.remove(directory, { recursive: true }).pipe(Effect.ignore);
      return directory;
    }),
  );

  const markUnavailable = Effect.fn("ssh/controlMaster.markUnavailable")(function* (
    key: string,
    target: DesktopSshEnvironmentTarget,
    reason: string,
    cause?: unknown,
  ) {
    unavailable.set(key, reason);
    yield* Effect.logWarning("ssh.controlMaster.unavailable", {
      alias: target.alias,
      hostname: target.hostname,
      reason,
      ...(cause === undefined ? {} : { cause }),
    });
    return { socketPath: null, decision: "unavailable", reason } satisfies ControlMasterOutcome;
  });

  const prepareSocketPath = Effect.fn("ssh/controlMaster.prepareSocketPath")(function* (
    target: DesktopSshEnvironmentTarget,
    directory: string,
    platform: NodeJS.Platform,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const stateKey = yield* remoteStateKey(target);
    const primary = controlSocketPath({ directory, stateKey, platform });
    if (primary !== null) {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
      yield* fs.chmod(directory, 0o700);
      return primary;
    }
    return controlSocketPath({ directory: yield* fallbackDirectory, stateKey, platform });
  });

  const probe = Effect.fn("ssh/controlMaster.probe")(function* (
    master: OwnedMaster,
    target: DesktopSshEnvironmentTarget,
  ) {
    yield* annotateSshTargetSpan(target);
    const fs = yield* FileSystem.FileSystem;
    // Without its socket a command would quietly connect directly and pass.
    const socketExists = yield* fs
      .exists(master.socketPath)
      .pipe(Effect.orElseSucceed(() => false));
    const running = yield* master.process.isRunning.pipe(Effect.orElseSucceed(() => false));
    if (!socketExists || !running) {
      return false;
    }
    // `ssh -O check` only asks the local master, which answers even when its
    // connection is dead; a real command proves the whole path.
    return yield* runSshCommand(target, {
      controlPath: master.socketPath,
      remoteCommandArgs: ["true"],
      timeoutMs: MASTER_PROBE_TIMEOUT_MS,
      batchMode: "yes",
      purpose: "control-probe",
    }).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.logWarning("ssh.controlMaster.probe.failed", {
          alias: target.alias,
          hostname: target.hostname,
          cause,
        }).pipe(Effect.as(false)),
      ),
    );
  });

  const reuse = Effect.fn("ssh/controlMaster.reuse")(function* (
    key: string,
    target: DesktopSshEnvironmentTarget,
  ) {
    const master = masters.get(key);
    if (master === undefined) {
      return null;
    }
    if (yield* probe(master, target)) {
      return master.socketPath;
    }
    yield* close(key);
    return null;
  });

  const startMaster = Effect.fn("ssh/controlMaster.start")(function* (input: {
    readonly key: string;
    readonly target: DesktopSshEnvironmentTarget;
    readonly socketPath: string;
    readonly authOptions: SshAuth.SshAuthOptions;
  }): Effect.fn.Return<void, SshCommandError | SshInvalidTargetError, ControlMasterContext> {
    yield* annotateSshTargetSpan(input.target);
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const sshCommand = yield* resolveSshCommand;
    const hostSpec = yield* buildSshHostSpecEffect(input.target);
    const environment = yield* SshAuth.buildSshChildEnvironment({
      ...(input.authOptions.interactiveAuth === undefined
        ? {}
        : { interactiveAuth: input.authOptions.interactiveAuth }),
      ...(input.authOptions.authSecret === undefined
        ? {}
        : { authSecret: input.authOptions.authSecret }),
      authSecretDelivery: "file",
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
    const secretFile = environment[SshAuth.SSH_AUTH_SECRET_FILE_ENV];
    const forgetSecret =
      secretFile === undefined
        ? Effect.void
        : fs.remove(secretFile, { force: true }).pipe(Effect.ignore);
    const args = [
      ...baseSshArgs(input.target, {
        batchMode: input.authOptions.batchMode ?? "no",
        controlMaster: "yes",
        controlPath: input.socketPath,
      }),
      "-o",
      "ControlPersist=no",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-n",
      "-N",
      hostSpec,
    ];
    const command = [sshCommand, ...args];
    const scope = yield* Scope.make("sequential");
    // Finalizers run last-added first: kill, then forget the secret, then the socket.
    yield* Scope.addFinalizer(
      scope,
      fs.remove(input.socketPath, { force: true }).pipe(Effect.ignore),
    );
    yield* Scope.addFinalizer(scope, forgetSecret);
    yield* Effect.logDebug("ssh.controlMaster.spawn.start", {
      alias: input.target.alias,
      hostname: input.target.hostname,
      command,
    });
    const child = yield* spawner
      .spawn(
        ChildProcess.make(sshCommand, args, {
          env: environment,
          extendEnv: true,
          forceKillAfter: MASTER_KILL_GRACE_MS,
          stdin: { stream: Stream.empty, endOnDone: true },
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.mapError(
          (cause) =>
            new SshCommandError({
              command,
              exitCode: null,
              stderr: "",
              message:
                cause instanceof Error
                  ? cause.message
                  : `Failed to spawn the SSH control master for ${hostSpec}.`,
              cause,
            }),
        ),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      );
    yield* Scope.addFinalizer(
      scope,
      child
        .kill({ killSignal: "SIGTERM", forceKillAfter: MASTER_KILL_GRACE_MS })
        .pipe(Effect.ignore),
    );

    let stderrSoFar = "";
    const exited = yield* Deferred.make<{
      readonly stderr: string;
      readonly exitCode: number | null;
    }>();
    // Drains stderr for the master's whole life and, once it is registered,
    // forgets a master that exits on its own so the next acquire replaces it.
    yield* Effect.all(
      [
        collectProcessOutput(child.stderr, (text) =>
          Effect.sync(() => {
            stderrSoFar = (stderrSoFar + text).slice(-MAX_MASTER_STDERR_LENGTH);
          }),
        ).pipe(Effect.orElseSucceed(() => stderrSoFar)),
        child.exitCode.pipe(
          Effect.map(Number),
          Effect.orElseSucceed(() => null),
        ),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.flatMap(([stderr, exitCode]) => Deferred.succeed(exited, { stderr, exitCode })),
      Effect.andThen(
        Effect.suspend(() => {
          if (masters.get(input.key)?.process !== child) {
            return Effect.void;
          }
          masters.delete(input.key);
          return Effect.logInfo("ssh.controlMaster.exited", {
            alias: input.target.alias,
            hostname: input.target.hostname,
            stderr: stderrSoFar,
          }).pipe(
            // Closing the scope interrupts this fiber, so it runs on its own.
            Effect.andThen(Scope.close(scope, Exit.void).pipe(Effect.forkIn(managerScope))),
            Effect.asVoid,
          );
        }),
      ),
      Effect.forkIn(scope),
    );

    // ssh opens the socket only after authenticating, so the socket is the ready signal.
    const socketReady = Effect.gen(function* () {
      while (true) {
        if (yield* fs.exists(input.socketPath).pipe(Effect.orElseSucceed(() => false))) {
          return;
        }
        if (stderrSoFar.includes("disabling multiplexing")) {
          return yield* new SshCommandError({
            command,
            exitCode: null,
            stderr: stderrSoFar,
            message: stderrSoFar.trim(),
          });
        }
        yield* Effect.sleep(Duration.millis(MASTER_READY_POLL_MS));
      }
    });
    const died = Deferred.await(exited).pipe(
      Effect.flatMap(({ stderr, exitCode }) =>
        Effect.fail(
          new SshCommandError({
            command,
            exitCode,
            stderr,
            message:
              stderr.trim() ||
              `SSH control master for ${hostSpec} exited (exit ${exitCode ?? "unknown"}).`,
          }),
        ),
      ),
    );
    yield* Effect.raceFirst(socketReady, died).pipe(
      Effect.timeoutOption(Duration.millis(MASTER_READY_TIMEOUT_MS)),
      Effect.flatMap(
        Option.match({
          onSome: () => Effect.void,
          onNone: () =>
            Effect.fail(
              new SshCommandError({
                command,
                exitCode: null,
                stderr: stderrSoFar,
                timedOut: true,
                message: `SSH control master for ${hostSpec} did not open its socket within ${MASTER_READY_TIMEOUT_MS}ms.`,
              }),
            ),
        }),
      ),
      Effect.ensuring(forgetSecret),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    masters.set(input.key, { socketPath: input.socketPath, process: child, scope });
    yield* Effect.logInfo("ssh.controlMaster.ready", {
      alias: input.target.alias,
      hostname: input.target.hostname,
      socketPath: input.socketPath,
    });
  });

  const acquire = Effect.fn("ssh/controlMaster.acquire")(function* <
    E extends { readonly _tag: string },
    R,
  >(
    request: ControlMasterRequest<E, R>,
  ): Effect.fn.Return<ControlMasterOutcome, E, R | ControlMasterContext> {
    const platform = yield* HostProcess.Platform;
    const { key, target } = request;
    yield* annotateSshTargetSpan(target);
    if (options.directory === undefined || platform === "win32") {
      return { socketPath: null, decision: "disabled" };
    }
    const unavailableReason = unavailable.get(key);
    if (unavailableReason !== undefined) {
      return { socketPath: null, decision: "unavailable", reason: unavailableReason };
    }
    const reused = yield* reuse(key, target);
    if (reused !== null) {
      return { socketPath: reused, decision: "reused" };
    }

    const fs = yield* FileSystem.FileSystem;
    const socketPathExit = yield* Effect.exit(
      prepareSocketPath(target, options.directory, platform),
    );
    if (Exit.isFailure(socketPathExit)) {
      return yield* markUnavailable(key, target, "socket-directory", socketPathExit.cause);
    }
    const socketPath = socketPathExit.value;
    if (socketPath === null) {
      return yield* markUnavailable(key, target, "socket-path-too-long");
    }
    // Only this app writes to the socket directory, so a socket already there
    // belongs to a master an earlier run left behind: ask it to exit, then clear it.
    if (yield* fs.exists(socketPath).pipe(Effect.orElseSucceed(() => false))) {
      yield* runSshCommand(target, {
        controlPath: socketPath,
        preHostArgs: ["-O", "exit"],
        timeoutMs: MASTER_PROBE_TIMEOUT_MS,
        batchMode: "yes",
        purpose: "control-exit",
      }).pipe(Effect.ignore);
      yield* fs.remove(socketPath, { force: true }).pipe(Effect.ignore);
    }

    return yield* request
      .authenticate((authOptions) => startMaster({ key, target, socketPath, authOptions }))
      .pipe(
        Effect.as<ControlMasterOutcome>({ socketPath, decision: "created" }),
        // A cancelled prompt or rejected credential would fail the direct
        // connection the same way, and must not cost the target its master.
        Effect.catchIf(
          (error) => error._tag !== "SshPasswordPromptError" && !SshAuth.isSshAuthFailure(error),
          (error) => markUnavailable(key, target, "master-failed", error),
        ),
      );
  });

  return { acquire, reuse, close };
});
