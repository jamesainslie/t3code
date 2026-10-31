import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@lathe/shared/Net";
import * as HostProcess from "@lathe/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as SshAuth from "./auth.ts";
import { SshCommandError } from "./errors.ts";
import { SshOutputObserver, type SshOutputChunk } from "./output.ts";
import * as SshTunnel from "./tunnel.ts";

const makeSuccessfulProcess = (stdout: string) => {
  const stdoutStream = Stream.make(new TextEncoder().encode(stdout));
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: stdoutStream,
    stderr: Stream.empty,
    all: stdoutStream,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const makeRunningProcess = (onKill: () => void) => {
  let finish: ((exitCode: ChildProcessSpawner.ExitCode) => void) | null = null;
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    exitCode: Effect.callback<ChildProcessSpawner.ExitCode>((resume) => {
      finish = (exitCode) => resume(Effect.succeed(exitCode));
      return Effect.sync(() => {
        finish = null;
      });
    }),
    isRunning: Effect.succeed(true),
    kill: () =>
      Effect.sync(() => {
        onKill();
        finish?.(ChildProcessSpawner.ExitCode(143));
      }),
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const testHttpClient = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 200 }))),
);

const hangingHttpClient = HttpClient.make(() => Effect.never);

const testNetService = NetService.NetService.of({
  canListenOnHost: () => Effect.succeed(true),
  isPortAvailableOnLoopback: () => Effect.succeed(true),
  hasListenerOnHost: () => Effect.succeed(false),
  reserveLoopbackPort: () => Effect.succeed(41_773),
  findAvailablePort: (preferred) => Effect.succeed(preferred),
});

function commandArgs(command: ChildProcess.Command): ReadonlyArray<string> {
  return command._tag === "StandardCommand" ? command.args : [];
}

// Every ssh command ends its options with `--`; only the launch passes a second one to the remote sh.
const isLaunchCommand = (args: ReadonlyArray<string>) =>
  args.indexOf("--") !== args.lastIndexOf("--");

/** Keeps every Info-and-above log as its message and fields, for asserting what was logged. */
const captureLogs = () => {
  const entries: Array<{
    readonly level: string;
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }> = [];
  const logger = Logger.make(({ logLevel, message }) => {
    const [text, fields] = Array.isArray(message) ? message : [message];
    entries.push({
      level: logLevel,
      message: String(text),
      fields: typeof fields === "object" && fields !== null ? { ...fields } : {},
    });
  });
  return {
    entries,
    layer: Logger.layer([logger], { mergeWithExisting: false }),
    named: (message: string) => entries.filter((entry) => entry.message === message),
  };
};

const ARCHIVE = { archiveVersion: "1.2.3-preview.20260911.4" } as const;
const NODE_SCRIPT = {
  nodeScriptPath: "/Users/julius/Development/Work/codething-mvp/apps/server/dist/bin.mjs",
} as const;

describe("ssh tunnel scripts", () => {
  it("rejects archive versions that are not a single exact version segment", () => {
    for (const archiveVersion of [
      "../other",
      "1.2.3/evil",
      "1.2.3\\evil",
      "1.2.3-preview.1 x",
      "1.2.3-preview.1\nrm -rf /",
      "v1.2.3",
    ]) {
      assert.throws(
        () => SshTunnel.buildRemoteLatheRunnerScript({ archiveVersion }),
        SshTunnel.SshInvalidArchiveVersionError,
        undefined,
        archiveVersion,
      );
    }
    assert.include(
      SshTunnel.buildRemoteLatheRunnerScript(ARCHIVE),
      "LATHE_ARCHIVE_VERSION='1.2.3-preview.20260911.4'",
    );
  });

  it.effect("accepts launch JSON after remote shell startup noise", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawnedCommands: Array<ReadonlyArray<string>> = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        spawnedCommands.push(commandArgs(command));
        return makeSuccessfulProcess('loaded nvm default\n{"remotePort":3774}\n');
      }),
    );
    const layerSpawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const layerProcess = Layer.merge(NodeServices.layer, layerSpawner);

    return Effect.gen(function* () {
      const result = yield* SshTunnel.launchOrReuseRemoteServer(target, undefined, ARCHIVE);
      assert.equal(result.remotePort, 3774);
      assert.deepEqual(spawnedCommands[0]?.slice(-5, -1), ["sh", "-l", "-s", "--"]);
    }).pipe(Effect.provide(layerProcess));
  });

  // Pairing always follows a launch in the same ensure, so the runtime is
  // already installed and the default command budget applies.
  it.effect("gives pairing the default command timeout even for archive runners", () => {
    const target = { alias: "devbox", hostname: "devbox", username: null, port: null } as const;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(makeRunningProcess(() => undefined)),
    );
    const layerProcess = Layer.merge(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.result(SshTunnel.issueRemotePairingToken(target, undefined, ARCHIVE)),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(60));
      const exit = fiber.pollUnsafe();

      assert.isDefined(exit);
      if (exit !== undefined && Exit.isSuccess(exit) && Result.isFailure(exit.value)) {
        assert.equal(exit.value.failure.message, "SSH command timed out after 60000ms.");
      } else {
        assert.fail("Pairing did not time out at 60s.");
      }
    }).pipe(Effect.provide(layerProcess));
  });

  it.effect("accepts pretty-printed pairing JSON after remote shell startup noise", () => {
    const target = {
      alias: "devbox",
      hostname: "devbox.example.com",
      username: "julius",
      port: 2222,
    } as const;
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        makeSuccessfulProcess(`loaded nvm default
{
  "id": "88941235-6ed5-4184-a2ff-5339e2075958",
  "credential": "LCL4R2TPHDKQ",
  "scopes": ["orchestration:read"],
  "expiresAt": "2026-04-29T01:01:20.994Z"
}

`),
      ),
    );
    const layerSpawner = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const layerProcess = Layer.merge(NodeServices.layer, layerSpawner);
    return Effect.gen(function* () {
      const result = yield* SshTunnel.issueRemotePairingToken(target, undefined, ARCHIVE);
      assert.equal(result.credential, "LCL4R2TPHDKQ");
    }).pipe(Effect.provide(layerProcess));
  });

  it.effect("retains a bounded diagnostic tail when the tunnel exits before readiness", () =>
    Effect.gen(function* () {
      const diagnostic = "Connection refused: café";
      const output = new TextEncoder().encode(
        "old diagnostics\n" + "x".repeat(32_768) + "\n" + diagnostic,
      );
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.succeed(
          commandArgs(command).includes("-N")
            ? {
                ...makeSuccessfulProcess(""),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
                stderr: Stream.make(output.subarray(0, output.length - 1), output.subarray(-1)),
              }
            : makeSuccessfulProcess('{"remotePort":3773}\n'),
        ),
      );
      const layer = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Layer.succeed(HttpClient.HttpClient, hangingHttpClient),
        Layer.succeed(NetService.NetService, testNetService),
        SshAuth.SshPasswordPrompt.disabledLayer,
        SshTunnel.SshEnvironmentManager.layer({ resolveCliRunner: Effect.succeed(ARCHIVE) }),
      );
      yield* Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        const result = yield* Effect.result(
          manager.ensureEnvironment({
            alias: "devbox",
            hostname: "devbox",
            username: null,
            port: null,
          }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, SshCommandError);
          if (result.failure instanceof SshCommandError) {
            assert.equal(result.failure.exitCode, 1);
            assert.equal(result.failure.stderr.length, 16_384);
            assert.isTrue(result.failure.stderr.endsWith(diagnostic));
            assert.equal(result.failure.message, result.failure.stderr.trim());
          }
        }
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("reports the real exit when reading tunnel diagnostics fails", () =>
    Effect.gen(function* () {
      const diagnostic = "Permission denied (publickey)";
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.succeed(
          commandArgs(command).includes("-N")
            ? {
                ...makeSuccessfulProcess(""),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(255)),
                stderr: Stream.make(new TextEncoder().encode(diagnostic)).pipe(
                  Stream.concat(
                    Stream.fail(
                      PlatformError.systemError({
                        _tag: "Unknown",
                        module: "Stream",
                        method: "read",
                        description: "stderr read failed",
                      }),
                    ),
                  ),
                ),
              }
            : makeSuccessfulProcess('{"remotePort":3773}\n'),
        ),
      );
      const layer = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Layer.succeed(HttpClient.HttpClient, hangingHttpClient),
        Layer.succeed(NetService.NetService, testNetService),
        SshAuth.SshPasswordPrompt.disabledLayer,
        SshTunnel.SshEnvironmentManager.layer({ resolveCliRunner: Effect.succeed(ARCHIVE) }),
      );
      yield* Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        const result = yield* Effect.result(
          manager.ensureEnvironment({
            alias: "devbox",
            hostname: "devbox",
            username: null,
            port: null,
          }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, SshCommandError);
          if (result.failure instanceof SshCommandError) {
            assert.equal(result.failure.exitCode, 255);
            assert.equal(result.failure.stderr, diagnostic);
          }
        }
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect.each(["local tunnel", "remote server"] as const)(
    "waits for %s shutdown before reconnecting the same target",
    (stalledStep) =>
      Effect.gen(function* () {
        const shutdownStarted = yield* Deferred.make<void>();
        const finishShutdown = yield* Deferred.make<void>();
        const reconnectsStarted = yield* Deferred.make<void>();
        const pauseShutdown = Deferred.succeed(shutdownStarted, undefined).pipe(
          Effect.andThen(Deferred.await(finishShutdown)),
        );
        let resolutions = 0;
        let launches = 0;
        let tunnels = 0;
        let stops = 0;
        let remoteRunning = false;
        const target = { alias: "devbox", hostname: "devbox", username: null, port: null };
        const spawner = ChildProcessSpawner.make((command) =>
          Effect.gen(function* () {
            const args = commandArgs(command);
            const isTarget = args.includes(target.alias);
            if (args.includes("-G")) {
              if (isTarget && ++resolutions === 4) {
                yield* Deferred.succeed(reconnectsStarted, undefined);
              }
              return makeSuccessfulProcess("");
            }
            if (args.includes("-N")) {
              const tunnel = makeRunningProcess(() => undefined);
              if (isTarget && ++tunnels === 1 && stalledStep === "local tunnel") {
                return {
                  ...tunnel,
                  kill: (options?: ChildProcess.KillOptions) =>
                    pauseShutdown.pipe(Effect.andThen(tunnel.kill(options))),
                };
              }
              return tunnel;
            }
            if (args.some((arg, index) => arg === "-s" && args[index + 1] === "--")) {
              if (isTarget) {
                launches += 1;
                remoteRunning = true;
              }
              return makeSuccessfulProcess('{"remotePort":3773}\n');
            }
            const stop = makeSuccessfulProcess('{"stopped":true}\n');
            if (!isTarget) return stop;
            const pause = ++stops === 1 && stalledStep === "remote server";
            return {
              ...stop,
              exitCode: (pause ? pauseShutdown : Effect.void).pipe(
                Effect.andThen(
                  Effect.sync(() => {
                    remoteRunning = false;
                    return ChildProcessSpawner.ExitCode(0);
                  }),
                ),
              ),
            };
          }),
        );
        const layer = Layer.mergeAll(
          NodeServices.layer,
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Layer.succeed(HttpClient.HttpClient, testHttpClient),
          Layer.succeed(NetService.NetService, testNetService),
          SshAuth.SshPasswordPrompt.disabledLayer,
          SshTunnel.SshEnvironmentManager.layer({ resolveCliRunner: Effect.succeed(ARCHIVE) }),
        );
        yield* Effect.gen(function* () {
          const manager = yield* SshTunnel.SshEnvironmentManager;
          yield* manager.ensureEnvironment(target);
          const disconnect = yield* Effect.forkChild(manager.disconnectEnvironment(target));
          yield* Deferred.await(shutdownStarted);
          const firstReconnect = yield* Effect.forkChild(manager.ensureEnvironment(target));
          const secondReconnect = yield* Effect.forkChild(manager.ensureEnvironment(target));
          yield* Deferred.await(reconnectsStarted);

          yield* manager.ensureEnvironment({
            alias: "other",
            hostname: "other",
            username: null,
            port: null,
          });
          yield* TestClock.adjust(Duration.zero);
          const launchesBeforeShutdown = launches;
          yield* Deferred.succeed(finishShutdown, undefined);
          yield* Fiber.join(disconnect);
          const first = yield* Fiber.join(firstReconnect);
          const second = yield* Fiber.join(secondReconnect);

          assert.equal(launchesBeforeShutdown, 1);
          assert.equal(launches, 2);
          assert.equal(tunnels, 2);
          assert.isTrue(remoteRunning);
          assert.equal(first.httpBaseUrl, second.httpBaseUrl);
        }).pipe(
          Effect.ensuring(Deferred.succeed(finishShutdown, undefined)),
          Effect.provide(layer),
          Effect.scoped,
        );
      }),
  );

  describe("dead tunnels", () => {
    const target = { alias: "devbox", hostname: "devbox", username: null, port: null };

    /** Records each ssh step in order; tunnels exit on kill or when the test says so. */
    const recordingLayer = (input: { readonly isHealthy: () => boolean }) => {
      const events: Array<string> = [];
      const logs = captureLogs();
      const tunnelExits: Array<Deferred.Deferred<ChildProcessSpawner.ExitCode>> = [];
      const tunnelCloses: Array<Deferred.Deferred<void>> = [];
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.gen(function* () {
          const args = commandArgs(command);
          if (args.includes("-G")) return makeSuccessfulProcess("");
          if (args.includes("-N")) {
            events.push("tunnel");
            const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
            const closed = yield* Deferred.make<void>();
            tunnelExits.push(exited);
            tunnelCloses.push(closed);
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(123),
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              exitCode: Deferred.await(exited),
              isRunning: Effect.map(Deferred.isDone(exited), (done) => !done),
              kill: () =>
                Effect.sync(() => events.push("tunnel.kill")).pipe(
                  Effect.andThen(Deferred.succeed(exited, ChildProcessSpawner.ExitCode(143))),
                  Effect.andThen(Deferred.succeed(closed, undefined)),
                ),
              stdin: Sink.drain,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            });
          }
          if (isLaunchCommand(args)) {
            events.push("launch");
            return makeSuccessfulProcess('{"remotePort":3773,"serverKind":"managed"}\n');
          }
          events.push("stop");
          return makeSuccessfulProcess('{"stopped":true}\n');
        }),
      );
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          events.push("http");
          return HttpClientResponse.fromWeb(
            request,
            new Response("", { status: input.isHealthy() ? 200 : 503 }),
          );
        }),
      );
      const layer = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(NetService.NetService, testNetService),
        SshAuth.SshPasswordPrompt.disabledLayer,
        SshTunnel.SshEnvironmentManager.layer({ resolveCliRunner: Effect.succeed(ARCHIVE) }),
        logs.layer,
      );
      return { events, tunnelExits, tunnelCloses, layer, logs };
    };

    it.effect("closes a stale tunnel without stopping the remote server it reconnects to", () => {
      let broken = false;
      const count = (event: string) => events.filter((entry) => entry === event).length;
      // A broken first tunnel stops answering, as when a network drop leaves the
      // ssh child alive; the replacement tunnel answers.
      const { events, layer, logs } = recordingLayer({
        isHealthy: () => !broken || count("tunnel") === 2,
      });
      return Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        yield* manager.ensureEnvironment(target);
        broken = true;
        const reconnect = yield* Effect.forkChild(manager.ensureEnvironment(target));
        yield* TestClock.adjust(Duration.seconds(3));
        yield* Fiber.join(reconnect);

        assert.equal(count("stop"), 0);
        assert.equal(count("tunnel.kill"), 1);
        assert.equal(count("launch"), 2);
        assert.equal(count("tunnel"), 2);
        const summaries = logs.named("ssh.environment.ensure.succeeded");
        assert.deepEqual(
          summaries.map((entry) => entry.fields.tunnel),
          ["created", "stale-replaced"],
        );
        assert.notProperty(summaries[0]?.fields ?? {}, "existingTunnelCheckMs");
        assert.isAtLeast(Number(summaries[1]?.fields.existingTunnelCheckMs), 2_000);
      }).pipe(
        Effect.provide(layer),
        Effect.scoped,
        // Shutting the manager down still stops the server it owns, exactly once.
        Effect.andThen(
          Effect.sync(() => {
            assert.equal(count("stop"), 1);
            assert.equal(count("tunnel.kill"), 2);
          }),
        ),
      );
    });

    it.effect("forgets a tunnel whose ssh process exits so the next ensure starts fresh", () => {
      const { events, tunnelExits, tunnelCloses, layer, logs } = recordingLayer({
        isHealthy: () => true,
      });
      return Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        yield* manager.ensureEnvironment(target);
        const [firstExit] = tunnelExits;
        const [firstClosed] = tunnelCloses;
        if (firstExit === undefined || firstClosed === undefined) {
          return yield* Effect.die(new Error("The first ensure spawned no tunnel."));
        }
        events.length = 0;

        // Fails with a timeout, rather than hanging, if nothing prunes the entry.
        const pruned = yield* Effect.forkChild(
          Deferred.await(firstClosed).pipe(Effect.timeout(Duration.seconds(1))),
        );
        yield* Deferred.succeed(firstExit, ChildProcessSpawner.ExitCode(255));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Fiber.join(pruned);
        // Pruning closes the dead entry but never stops the remote server.
        assert.deepEqual(events, ["tunnel.kill"]);
        events.length = 0;

        yield* manager.ensureEnvironment(target);

        assert.deepEqual(events, ["launch", "tunnel", "http"]);
        assert.deepEqual(
          logs.named("ssh.environment.ensure.succeeded").map((entry) => entry.fields.tunnel),
          ["created", "pruned-exited"],
        );
      }).pipe(Effect.provide(layer), Effect.scoped);
    });

    /** Ensures the target, then lets its tunnel's ssh exit and waits until it is pruned. */
    const ensureThenLoseTunnel = (input: {
      readonly tunnelExits: ReadonlyArray<Deferred.Deferred<ChildProcessSpawner.ExitCode>>;
      readonly tunnelCloses: ReadonlyArray<Deferred.Deferred<void>>;
    }) =>
      Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        yield* manager.ensureEnvironment(target);
        const [exit] = input.tunnelExits;
        const [closed] = input.tunnelCloses;
        if (exit === undefined || closed === undefined) {
          return yield* Effect.die(new Error("The ensure spawned no tunnel."));
        }
        const pruned = yield* Effect.forkChild(
          Deferred.await(closed).pipe(Effect.timeout(Duration.seconds(1))),
        );
        yield* Deferred.succeed(exit, ChildProcessSpawner.ExitCode(255));
        yield* TestClock.adjust(Duration.seconds(1));
        yield* Fiber.join(pruned);
        return manager;
      });

    // Quitting the app stops the managed servers it started, as it did before
    // dead tunnels were pruned from the manager.
    it.effect("stops a managed server whose tunnel died once the manager shuts down", () => {
      const recording = recordingLayer({ isHealthy: () => true });
      const count = (event: string) => recording.events.filter((entry) => entry === event).length;
      return ensureThenLoseTunnel(recording).pipe(
        Effect.tap(() => Effect.sync(() => assert.equal(count("stop"), 0))),
        Effect.provide(recording.layer),
        Effect.scoped,
        Effect.andThen(Effect.sync(() => assert.equal(count("stop"), 1))),
      );
    });

    it.effect("does not stop a disconnected server again when the manager shuts down", () => {
      const recording = recordingLayer({ isHealthy: () => true });
      const count = (event: string) => recording.events.filter((entry) => entry === event).length;
      return ensureThenLoseTunnel(recording).pipe(
        Effect.flatMap((manager) => manager.disconnectEnvironment(target)),
        Effect.tap(() => Effect.sync(() => assert.equal(count("stop"), 1))),
        Effect.provide(recording.layer),
        Effect.scoped,
        Effect.andThen(Effect.sync(() => assert.equal(count("stop"), 1))),
      );
    });
  });
});

describe("ssh environment output", () => {
  const target = {
    alias: "devbox",
    hostname: "devbox.example.com",
    username: "julius",
    port: 2222,
  } as const;
  const encode = (text: string) => Stream.make(new TextEncoder().encode(text));
  const makeExitedProcess = (input: {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number;
  }) =>
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(123),
      stdout: input.stdout === undefined ? Stream.empty : encode(input.stdout),
      stderr: input.stderr === undefined ? Stream.empty : encode(input.stderr),
      all: Stream.empty,
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });
  const REMOTE_LOG = "Error: listen EADDRINUSE 127.0.0.1:3773\n";

  /** Routes each ssh invocation by its shape: resolve, tunnel, launch, or a bare script. */
  const managerLayer = (input: {
    readonly launch: () => ChildProcessSpawner.ChildProcessHandle;
    readonly tunnel?: () => ChildProcessSpawner.ChildProcessHandle;
    readonly http?: HttpClient.HttpClient;
    readonly runner?: typeof ARCHIVE | typeof NODE_SCRIPT;
  }) =>
    Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            const args = commandArgs(command);
            if (args.includes("-G")) return makeExitedProcess({ stdout: "\n" });
            if (args.includes("-N")) return input.tunnel?.() ?? makeRunningProcess(() => {});
            if (isLaunchCommand(args)) return input.launch();
            // Pairing and the log tail are both bare `sh -s` scripts. A pairing answer
            // that leaked would show up as its credential in the observed output.
            return makeExitedProcess({
              stdout: `${REMOTE_LOG}{"credential":"LCL4R2TPHDKQ"}\n`,
            });
          }),
        ),
      ),
      Layer.succeed(HttpClient.HttpClient, input.http ?? testHttpClient),
      Layer.succeed(NetService.NetService, testNetService),
      SshAuth.SshPasswordPrompt.disabledLayer,
      SshTunnel.SshEnvironmentManager.layer({
        resolveCliRunner: Effect.succeed(input.runner ?? ARCHIVE),
      }),
      TestClock.layer(),
    );

  const observed = () => {
    const chunks: Array<SshOutputChunk> = [];
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(SshOutputObserver, (chunk) =>
          Effect.sync(() => {
            chunks.push(chunk);
          }),
        ),
      );
    return { chunks, provide };
  };

  it.effect("reports launch output while connecting, but never the pairing credential", () => {
    const { chunks, provide } = observed();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* provide(manager.ensureEnvironment(target, { issuePairingToken: true }));

      assert.deepInclude(chunks, {
        source: "launch",
        stream: "stderr",
        text: "installing t3 1.2.3\n",
      });
      assert.deepInclude(chunks, {
        source: "launch",
        stream: "stdout",
        text: '{"remotePort":3773}\n',
      });
      assert.isFalse(chunks.some((chunk) => chunk.text.includes("LCL4R2TPHDKQ")));
    }).pipe(
      Effect.provide(
        managerLayer({
          launch: () =>
            makeExitedProcess({
              stdout: '{"remotePort":3773}\n',
              stderr: "installing t3 1.2.3\n",
            }),
        }),
      ),
    );
  });

  it.effect("reads the remote server log when a launch times out", () => {
    const { chunks, provide } = observed();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      const fiber = yield* Effect.forkChild(
        Effect.result(provide(manager.ensureEnvironment(target))),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.seconds(210));
      const result = yield* Fiber.join(fiber);

      assert.isTrue(Result.isFailure(result));
      assert.deepInclude(chunks, {
        source: "remote-log",
        stream: "stdout",
        text: `${REMOTE_LOG}{"credential":"LCL4R2TPHDKQ"}\n`,
      });
    }).pipe(
      Effect.provide(
        managerLayer({ launch: () => makeRunningProcess(() => {}), runner: NODE_SCRIPT }),
      ),
    );
  });

  it.effect("reports the tunnel's own error and the remote log when the tunnel dies", () => {
    const { chunks, provide } = observed();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      const result = yield* Effect.result(provide(manager.ensureEnvironment(target)));

      assert.isTrue(Result.isFailure(result));
      assert.deepInclude(chunks, {
        source: "tunnel",
        stream: "stderr",
        text: "channel 2: open failed: connect failed: Connection refused\n",
      });
      assert.isTrue(chunks.some((chunk) => chunk.source === "remote-log"));
    }).pipe(
      Effect.provide(
        managerLayer({
          launch: () => makeExitedProcess({ stdout: '{"remotePort":3773}\n' }),
          tunnel: () =>
            makeExitedProcess({
              stderr: "channel 2: open failed: connect failed: Connection refused\n",
              exitCode: 255,
            }),
          http: hangingHttpClient,
        }),
      ),
    );
  });

  it.effect.each([
    ["reused", "Remote server reused on port 3773"],
    ["started", "Remote server started on port 3773"],
    ["restarted-runner-changed", "Remote server restarted on port 3773: runner changed"],
    ["adopted-external", "Using the external remote server on port 3773"],
    [
      "replaced-by-external",
      "Stopped the managed remote server, using the external one on port 3773",
    ],
    ["reused-external", "External remote server reused on port 3773"],
  ] as const)("reports a %s launch in the output and the ready log", ([action, line]) => {
    const { chunks, provide } = observed();
    const logs = captureLogs();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* provide(manager.ensureEnvironment(target));

      assert.deepInclude(chunks, { source: "launch", stream: "stdout", text: `${line}\n` });
      const [ready] = logs.named("ssh.remoteServer.launch.ready");
      assert.equal(ready?.fields.launchAction, action);
      const [succeeded] = logs.named("ssh.environment.ensure.succeeded");
      assert.equal(succeeded?.fields.launchAction, action);
    }).pipe(
      Effect.provide(
        Layer.merge(
          managerLayer({
            launch: () =>
              makeExitedProcess({
                stdout: `{"remotePort":3773,"serverKind":"managed","action":"${action}"}\n`,
              }),
          }),
          logs.layer,
        ),
      ),
    );
  });

  it.effect("accepts a launch answer without an action and reports none", () => {
    const { chunks, provide } = observed();
    const logs = captureLogs();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* provide(manager.ensureEnvironment(target));

      assert.deepEqual(
        chunks.map((chunk) => chunk.text),
        ['{"remotePort":3773}\n'],
      );
      const [ready] = logs.named("ssh.remoteServer.launch.ready");
      assert.isNull(ready?.fields.launchAction);
    }).pipe(
      Effect.provide(
        Layer.merge(
          managerLayer({ launch: () => makeExitedProcess({ stdout: '{"remotePort":3773}\n' }) }),
          logs.layer,
        ),
      ),
    );
  });

  it.effect("summarizes a failed ensure once, with the phases that ran and the error", () => {
    const logs = captureLogs();
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      const result = yield* Effect.result(manager.ensureEnvironment(target));

      assert.isTrue(Result.isFailure(result));
      assert.lengthOf(logs.named("ssh.environment.ensure.succeeded"), 0);
      const failed = logs.named("ssh.environment.ensure.failed");
      assert.lengthOf(failed, 1);
      const fields = failed[0]?.fields ?? {};
      assert.equal(failed[0]?.level, "Info");
      assert.equal(fields.alias, "devbox");
      assert.equal(fields.errorTag, "SshCommandError");
      assert.include(String(fields.errorMessage), "Connection refused");
      assert.equal(fields.tunnel, "created");
      assert.equal(fields.launchAction, "started");
      assert.equal(fields.remotePort, 3773);
      assert.equal(fields.issuedPairingToken, false);
      for (const phase of ["targetResolveMs", "lockWaitMs", "launchMs", "tunnelStartMs"]) {
        assert.isNumber(fields[phase], phase);
      }
      assert.notProperty(fields, "existingTunnelCheckMs");
      assert.notProperty(fields, "pairingMs");
    }).pipe(
      Effect.provide(
        Layer.merge(
          managerLayer({
            launch: () =>
              makeExitedProcess({
                stdout: '{"remotePort":3773,"serverKind":"managed","action":"started"}\n',
              }),
            tunnel: () =>
              makeExitedProcess({
                stderr: "channel 2: open failed: connect failed: Connection refused\n",
                exitCode: 255,
              }),
            http: hangingHttpClient,
          }),
          logs.layer,
        ),
      ),
    );
  });
});

const runScript = (home: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("sh", args, {
        env: { PATH: process.env.PATH ?? "", HOME: home },
        extendEnv: false,
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        child.stdout.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (acc, chunk) => acc + chunk,
          ),
        ),
        child.stderr.pipe(
          Stream.decodeText(),
          Stream.runFold(
            () => "",
            (acc, chunk) => acc + chunk,
          ),
        ),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, exitCode };
  });

describe("archive runner script", () => {
  const hostPlatform = HostProcess.Platform.defaultValue();
  const hostArch = HostProcess.Architecture.defaultValue();
  const windowsHost = hostPlatform === "win32";
  const archiveVersion = "1.2.3-preview.20260911.4";

  const runRunner = (home: string, runner: string) => runScript(home, [runner, "--version"]);

  // Fork: a current release publishes lathe-* and t3-* archives holding `lathe` and `t3`; a
  // pre-rename release has only t3-* holding `t3`. The current t3-* asset is a pre-rename archive
  // and each executable names itself, so the output shows which asset and executable the runner
  // chose.
  const makeMirror = Effect.fn("makeMirror")(function* (
    root: string,
    release_: "current" | "pre-rename" = "current",
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const platform = hostPlatform === "darwin" ? "darwin" : "linux";
    const arch = hostArch === "arm64" ? "arm64" : "x64";
    const stem = `t3-${archiveVersion}-${platform}-${arch}`;
    const stage = `${root}/stage/${stem}`;
    const legacyStage = `${root}/legacy-stage/${stem}`;
    const release = `${root}/mirror/v${archiveVersion}`;
    const asset = `${platform}-${arch}.tar.gz`;
    const sums = (names: ReadonlyArray<string>) =>
      `cd '${release}' && (sha256sum ${names.join(" ")} 2>/dev/null || shasum -a 256 ${names.join(" ")}) > SHA256SUMS`;
    const script = [
      "set -eu",
      `mkdir -p '${stage}' '${legacyStage}' '${release}'`,
      `printf '#!/bin/sh\\necho t3 v${archiveVersion}\\n' > '${legacyStage}/t3'`,
      `chmod +x '${legacyStage}/t3'`,
      `tar -czf '${release}/t3-${archiveVersion}-${asset}' -C '${root}/legacy-stage' '${stem}'`,
      ...(release_ === "current"
        ? [
            `printf '#!/bin/sh\\necho lathe v${archiveVersion}\\n' > '${stage}/lathe'`,
            `printf '#!/bin/sh\\necho alias t3 v${archiveVersion}\\n' > '${stage}/t3'`,
            `chmod +x '${stage}/lathe' '${stage}/t3'`,
            `tar -czf '${release}/lathe-${archiveVersion}-${asset}' -C '${root}/stage' '${stem}'`,
            sums([`'t3-${archiveVersion}-${asset}'`, `'lathe-${archiveVersion}-${asset}'`]),
          ]
        : [sums([`'t3-${archiveVersion}-${asset}'`])]),
    ].join("\n");
    const child = yield* spawner.spawn(ChildProcess.make("sh", ["-c", script]));
    assert.equal(Number(yield* child.exitCode), 0);
    return `file://${root}/mirror`;
  });

  // Fork: a remote reached by this release installs from a release published
  // before the Lathe rename, which only has t3-* assets holding `t3`.
  it.effect.skipIf(windowsHost)("installs and runs a release published before the rename", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-archive-runner-" });
      const releaseBaseUrl = yield* makeMirror(root, "pre-rename");
      const runner = `${root}/run-lathe.sh`;
      yield* fs.writeFileString(
        runner,
        SshTunnel.buildRemoteLatheRunnerScript({ archiveVersion, releaseBaseUrl }),
      );
      const home = `${root}/home`;
      yield* fs.makeDirectory(home, { recursive: true });

      const result = yield* runRunner(home, runner);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.trim(), `t3 v${archiveVersion}`);
      assert.isFalse(yield* fs.exists(`${home}/.lathe/runtime/versions/${archiveVersion}/lathe`));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  // Fork: a runtime an older runner unpacked holds only `t3`; it is complete,
  // so it runs as it is with nothing downloaded.
  it.effect.skipIf(windowsHost)(
    "runs a runtime an older runner unpacked without reinstalling it",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-archive-runner-" });
        const runner = `${root}/run-lathe.sh`;
        yield* fs.writeFileString(
          runner,
          SshTunnel.buildRemoteLatheRunnerScript({
            archiveVersion,
            releaseBaseUrl: `file://${root}/no-mirror`,
          }),
        );
        const home = `${root}/home`;
        const runtime = `${home}/.lathe/runtime/versions/${archiveVersion}`;
        yield* fs.makeDirectory(runtime, { recursive: true });
        yield* fs.writeFileString(`${runtime}/t3`, `#!/bin/sh\necho old t3 v${archiveVersion}\n`);
        yield* fs.chmod(`${runtime}/t3`, 0o755);
        yield* fs.writeFileString(`${runtime}/.launcher`, "exe\n");
        yield* fs.writeFileString(`${runtime}/.install-complete`, `${archiveVersion}\n`);

        const result = yield* runRunner(home, runner);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout.trim(), `old t3 v${archiveVersion}`);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  // Fork: a remote that still runs from the pre-rename base directory keeps
  // using it, so its running server, state and runtimes stay together.
  it.effect.skipIf(windowsHost)(
    "keeps installing into a pre-rename base directory that is still in use",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "lathe-archive-runner-" });
        const releaseBaseUrl = yield* makeMirror(root);
        const runner = `${root}/run-lathe.sh`;
        yield* fs.writeFileString(
          runner,
          SshTunnel.buildRemoteLatheRunnerScript({ archiveVersion, releaseBaseUrl }),
        );
        const home = `${root}/home`;
        yield* fs.makeDirectory(`${home}/.t3f`, { recursive: true });

        const result = yield* runRunner(home, runner);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(yield* fs.readDirectory(`${home}/.t3f/runtime/versions`), [
          archiveVersion,
        ]);
        assert.isFalse(yield* fs.exists(`${home}/.lathe`));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
