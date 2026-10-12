// @effect-diagnostics nodeBuiltinImport:off - the fake ssh child acts synchronously inside the spawner.
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as SshAuth from "./auth.ts";
import { controlSocketPath } from "./controlMaster.ts";
import * as SshTunnel from "./tunnel.ts";

const encoder = new TextEncoder();
const ARCHIVE = { archiveVersion: "1.2.3-preview.20260911.4" } as const;
const target = { alias: "devbox", hostname: "devbox", username: null, port: null };

describe("control socket path", () => {
  const stateKey = "711bc738002d72fd";

  it("names the socket after the target's state key", () => {
    assert.equal(
      controlSocketPath({ directory: "/Users/julius/.t3/ssh/", stateKey, platform: "darwin" }),
      "/Users/julius/.t3/ssh/711bc738002d72fd.sock",
    );
  });

  // OpenSSH binds `<path>.<16 random chars>` and links it into place, so that
  // name and its NUL must fit the platform's sun_path: 104 bytes on darwin and
  // 108 on linux.
  it("refuses a path whose temporary bind name would not fit the platform's sun_path", () => {
    const socketName = `/${stateKey}.sock`;
    const directoryOf = (bytes: number) => `/${"d".repeat(bytes - socketName.length - 1)}`;

    assert.isNotNull(
      controlSocketPath({ directory: directoryOf(86), stateKey, platform: "darwin" }),
    );
    assert.isNull(controlSocketPath({ directory: directoryOf(87), stateKey, platform: "darwin" }));
    assert.isNotNull(
      controlSocketPath({ directory: directoryOf(90), stateKey, platform: "linux" }),
    );
    assert.isNull(controlSocketPath({ directory: directoryOf(91), stateKey, platform: "linux" }));
    // Bytes, not characters.
    assert.isNull(
      controlSocketPath({
        directory: `/${"é".repeat(40)}`,
        stateKey,
        platform: "darwin",
      }),
    );
  });

  it("never multiplexes on Windows", () => {
    assert.isNull(controlSocketPath({ directory: "C:\\t3\\ssh", stateKey, platform: "win32" }));
  });
});

type MasterBehavior =
  | { readonly _tag: "ready" }
  | { readonly _tag: "exits"; readonly stderr: string }
  | { readonly _tag: "silent" };

/**
 * Routes each ssh invocation by shape and records it. Masters create their
 * socket file when told to be ready, like a real master after authentication.
 */
const makeHarness = (input: {
  readonly master?: (attempt: number) => MasterBehavior;
  readonly probe?: (attempt: number) => "ok" | "hang";
  readonly launch?: (attempt: number) => { readonly exitCode: number; readonly stderr?: string };
  readonly prompt?: () => string | null;
}) => {
  const events: Array<string> = [];
  const spawned: Array<{
    readonly kind: string;
    readonly args: ReadonlyArray<string>;
    readonly env: Record<string, string | undefined>;
  }> = [];
  const secretFilesSeen: Array<{ readonly path: string; readonly contents: string }> = [];
  let masters = 0;
  let probes = 0;
  let launches = 0;
  let prompts = 0;
  const spawnWaiters = new Map<string, () => void>();

  const exitedProcess = (stdout: string, exitCode = 0, stderr = "") =>
    ChildProcessSpawner.makeHandle({
      pid: ChildProcessSpawner.ProcessId(200),
      stdout: Stream.make(encoder.encode(stdout)),
      stderr: stderr.length === 0 ? Stream.empty : Stream.make(encoder.encode(stderr)),
      all: Stream.empty,
      exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
      isRunning: Effect.succeed(false),
      kill: () => Effect.void,
      stdin: Sink.drain,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    });

  const runningProcess = (name: string, stderr: string, onKill: () => void = () => {}) =>
    Effect.gen(function* () {
      const exited = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(300),
        stdout: Stream.empty,
        stderr: stderr.length === 0 ? Stream.empty : Stream.make(encoder.encode(stderr)),
        all: Stream.empty,
        exitCode: Deferred.await(exited),
        isRunning: Effect.map(Deferred.isDone(exited), (done) => !done),
        kill: () =>
          Effect.gen(function* () {
            if (yield* Deferred.isDone(exited)) return;
            events.push(`${name}.kill`);
            onKill();
            yield* Deferred.succeed(exited, ChildProcessSpawner.ExitCode(143));
          }),
        stdin: Sink.drain,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      });
    });

  const kindOf = (args: ReadonlyArray<string>) => {
    if (args.includes("ControlMaster=yes")) return "master";
    if (args.includes("-G")) return "resolve";
    if (args.includes("-O")) return `control.${args[args.indexOf("-O") + 1]}`;
    if (args.includes("-N")) return "tunnel";
    if (args.at(-1) === "true") return "probe";
    if (args.includes("--")) return "launch";
    return "script";
  };

  const spawner = ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      const args = command._tag === "StandardCommand" ? command.args : [];
      const env = command._tag === "StandardCommand" ? (command.options.env ?? {}) : {};
      const kind = kindOf(args);
      spawned.push({ kind, args, env });
      if (kind !== "resolve") events.push(kind);
      spawnWaiters.get(kind)?.();
      switch (kind) {
        case "resolve":
          return exitedProcess("");
        case "master": {
          const socket = controlPathOf(args);
          const secretFile = env.T3_SSH_AUTH_SECRET_FILE;
          if (secretFile !== undefined && NodeFS.existsSync(secretFile)) {
            secretFilesSeen.push({
              path: secretFile,
              contents: NodeFS.readFileSync(secretFile, "utf8"),
            });
          }
          const behavior = input.master?.(++masters) ?? { _tag: "ready" };
          if (behavior._tag === "exits") {
            return exitedProcess("", 255, behavior.stderr);
          }
          if (behavior._tag === "ready" && socket !== undefined) {
            NodeFS.writeFileSync(socket, "");
          }
          // A real master removes its socket when it is told to stop.
          return yield* runningProcess("master", "", () => {
            if (socket !== undefined) NodeFS.rmSync(socket, { force: true });
          });
        }
        case "probe":
          return (input.probe?.(++probes) ?? "ok") === "ok"
            ? exitedProcess("")
            : yield* runningProcess("probe", "");
        case "tunnel":
          return yield* runningProcess("tunnel", "");
        case "launch": {
          const result = input.launch?.(++launches) ?? { exitCode: 0 };
          return exitedProcess(
            result.exitCode === 0 ? '{"remotePort":3773,"serverKind":"managed"}\n' : "",
            result.exitCode,
            result.stderr ?? "",
          );
        }
        case "control.exit":
          return exitedProcess("", 255, "Control socket connect: Connection refused\n");
        default:
          return exitedProcess('{"credential":"LCL4R2TPHDKQ"}\n');
      }
    }),
  );

  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "cm-"));
  /** `directory: null` builds a manager that was given no socket directory. */
  const layer = (options: { readonly directory?: string | null } = {}) =>
    Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 200 }))),
        ),
      ),
      Layer.succeed(
        NetService.NetService,
        NetService.NetService.of({
          canListenOnHost: () => Effect.succeed(true),
          isPortAvailableOnLoopback: () => Effect.succeed(true),
          hasListenerOnHost: () => Effect.succeed(false),
          reserveLoopbackPort: () => Effect.succeed(41_773),
          findAvailablePort: (preferred) => Effect.succeed(preferred),
        }),
      ),
      input.prompt === undefined
        ? SshAuth.SshPasswordPrompt.disabledLayer
        : Layer.succeed(
            SshAuth.SshPasswordPrompt,
            SshAuth.SshPasswordPrompt.of({
              isAvailable: true,
              request: () =>
                Effect.sync(() => {
                  prompts += 1;
                  return input.prompt?.() ?? null;
                }),
            }),
          ),
      SshTunnel.SshEnvironmentManager.layer({
        resolveCliRunner: Effect.succeed(ARCHIVE),
        ...(options.directory === null
          ? {}
          : { controlSocketDirectory: options.directory ?? directory }),
      }),
    );

  const count = (event: string) => events.filter((entry) => entry === event).length;
  /**
   * Waits for the next ssh of `kind` to spawn, however much real I/O comes
   * first. Call it before starting the work so the spawn cannot be missed.
   */
  const nextSpawn = (kind: string) => {
    const spawned = new Promise<void>((resolve) => {
      spawnWaiters.set(kind, () => {
        spawnWaiters.delete(kind);
        resolve();
      });
    });
    return Effect.promise(() => spawned);
  };
  const argsOf = (kind: string) => spawned.filter((entry) => entry.kind === kind);
  return {
    events,
    spawned,
    secretFilesSeen,
    directory,
    layer,
    count,
    argsOf,
    prompts: () => prompts,
    nextSpawn,
  };
};

function controlPathOf(args: ReadonlyArray<string>): string | undefined {
  return args.find((arg) => arg.startsWith("ControlPath="))?.slice("ControlPath=".length);
}

/** Lets a just-spawned step reach its timeout, then moves the clock past it. */
const passTimeout = (spawned: Effect.Effect<void>, duration: Duration.Input) =>
  Effect.gen(function* () {
    yield* spawned;
    for (let turn = 0; turn < 10; turn += 1) {
      yield* Effect.yieldNow;
    }
    yield* TestClock.adjust(duration);
  });

function optionValues(args: ReadonlyArray<string>, name: string): Array<string> {
  return args.filter((arg) => arg.startsWith(`${name}=`));
}

describe("owned control master", () => {
  it.effect("runs one-shots through an owned master and keeps the tunnel direct", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target, { issuePairingToken: true });

      const [master] = harness.argsOf("master");
      assert.isDefined(master);
      const socket = controlPathOf(master?.args ?? []);
      assert.isTrue(socket?.startsWith(`${harness.directory}/`));
      assert.isTrue(socket?.endsWith(".sock"));
      for (const option of [
        "ControlMaster=yes",
        "ControlPersist=no",
        "ServerAliveInterval=15",
        "ServerAliveCountMax=3",
      ]) {
        assert.include(master?.args, option);
      }
      assert.include(master?.args, "-N");
      // ssh keeps the first value of an option, so nothing may pin it earlier.
      assert.deepEqual(optionValues(master?.args ?? [], "ControlMaster"), ["ControlMaster=yes"]);

      for (const kind of ["launch", "script"]) {
        for (const entry of harness.argsOf(kind)) {
          assert.deepEqual(optionValues(entry.args, "ControlMaster"), ["ControlMaster=no"]);
          assert.deepEqual(optionValues(entry.args, "ControlPath"), [`ControlPath=${socket}`]);
        }
      }
      // A mux client's forward belongs to the master and outlives the client,
      // so the tunnel keeps its own connection and its exit still means "gone".
      const [tunnel] = harness.argsOf("tunnel");
      assert.deepEqual(optionValues(tunnel?.args ?? [], "ControlPath"), ["ControlPath=none"]);
      assert.deepEqual(harness.events, ["master", "launch", "tunnel", "script"]);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("connects directly without a socket directory", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target, { issuePairingToken: true });

      assert.equal(harness.count("master"), 0);
      for (const entry of harness.spawned) {
        assert.deepEqual(optionValues(entry.args, "ControlPath"), ["ControlPath=none"]);
      }
    }).pipe(Effect.provide(harness.layer({ directory: null })), Effect.scoped);
  });

  it.effect("never starts a master on Windows", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager
        .ensureEnvironment(target, { issuePairingToken: true })
        .pipe(Effect.provideService(HostProcess.Platform, "win32"));

      assert.equal(harness.count("master"), 0);
      for (const entry of harness.spawned) {
        assert.deepEqual(optionValues(entry.args, "ControlPath"), ["ControlPath=none"]);
      }
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect(
    "moves the socket to a private temporary directory when the home path is too long",
    () => {
      const harness = makeHarness({});
      const longDirectory = `/${"d".repeat(90)}`;
      return Effect.gen(function* () {
        const manager = yield* SshTunnel.SshEnvironmentManager;
        yield* manager.ensureEnvironment(target);

        const socket = controlPathOf(harness.argsOf("master")[0]?.args ?? []) ?? "";
        assert.isTrue(socket.startsWith(NodeOS.tmpdir()));
        assert.isTrue((NodeFS.statSync(NodePath.dirname(socket)).mode & 0o077) === 0);
      }).pipe(Effect.provide(harness.layer({ directory: longDirectory })), Effect.scoped);
    },
  );

  it.effect("authenticates the master once and keeps the password out of its environment", () => {
    const harness = makeHarness({
      master: (attempt) =>
        attempt === 1
          ? { _tag: "exits", stderr: "devbox: Permission denied (publickey,password).\n" }
          : { _tag: "ready" },
      prompt: () => "hunter2",
    });
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target, { issuePairingToken: true });

      assert.equal(harness.prompts(), 1);
      assert.equal(harness.count("master"), 2);
      const [, authenticated] = harness.argsOf("master");
      assert.isUndefined(authenticated?.env.T3_SSH_AUTH_SECRET);
      assert.deepEqual(
        harness.secretFilesSeen.map((file) => file.contents),
        ["hunter2\n"],
      );
      // Deleted once the master is up.
      for (const file of harness.secretFilesSeen) {
        assert.isFalse(NodeFS.existsSync(file.path));
      }
      assert.equal(harness.count("launch"), 1);
      assert.equal(harness.count("script"), 1);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("replaces a master whose health probe hangs", () => {
    const harness = makeHarness({ probe: (attempt) => (attempt === 1 ? "hang" : "ok") });
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target);
      const probeSpawned = harness.nextSpawn("probe");
      const reconnect = yield* Effect.forkChild(
        manager.ensureEnvironment(target, { issuePairingToken: true }),
      );
      yield* passTimeout(probeSpawned, Duration.seconds(5));
      const result = yield* Fiber.join(reconnect);

      assert.equal(result.pairingToken, "LCL4R2TPHDKQ");
      assert.deepEqual(harness.events, [
        "master",
        "launch",
        "tunnel",
        "probe",
        "master.kill",
        "master",
        "script",
      ]);
      const sockets = harness.argsOf("master").map((entry) => controlPathOf(entry.args));
      assert.equal(sockets[0], sockets[1]);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("replaces the master when a command reports a broken mux", () => {
    const harness = makeHarness({
      launch: (attempt) =>
        attempt === 1
          ? {
              exitCode: 255,
              stderr: "mux_client_request_session: read from master failed: Broken pipe\n",
            }
          : { exitCode: 0 },
    });
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target);

      assert.deepEqual(harness.events, [
        "master",
        "launch",
        "master.kill",
        "master",
        "launch",
        "tunnel",
      ]);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("stops the remote through the master, then tears the master down on disconnect", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target);
      harness.events.length = 0;
      yield* manager.disconnectEnvironment(target);

      assert.deepEqual(harness.events, ["tunnel.kill", "probe", "script", "master.kill"]);
      const socket = controlPathOf(harness.argsOf("master")[0]?.args ?? []);
      assert.deepEqual(optionValues(harness.argsOf("script")[0]?.args ?? [], "ControlPath"), [
        `ControlPath=${socket}`,
      ]);
      assert.isFalse(NodeFS.existsSync(socket ?? ""));
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("stops owned masters when the manager shuts down", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* manager.ensureEnvironment(target);
      assert.equal(harness.count("master.kill"), 0);
    }).pipe(
      Effect.provide(harness.layer()),
      Effect.scoped,
      Effect.andThen(
        Effect.sync(() => {
          assert.equal(harness.count("master.kill"), 1);
          // The remote stop runs before the master goes away.
          assert.isBelow(harness.events.indexOf("script"), harness.events.indexOf("master.kill"));
        }),
      ),
    );
  });

  it.effect("creates one master and one tunnel for concurrent ensures of one target", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      yield* Effect.all([manager.ensureEnvironment(target), manager.ensureEnvironment(target)], {
        concurrency: "unbounded",
      });

      assert.equal(harness.count("master"), 1);
      assert.equal(harness.count("tunnel"), 1);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect("reclaims a socket left behind by an earlier run before starting a master", () => {
    const harness = makeHarness({});
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      // Learn the target's socket name, then simulate a crash that left it behind.
      yield* manager.ensureEnvironment(target);
      const socket = controlPathOf(harness.argsOf("master")[0]?.args ?? []) ?? "";
      yield* manager.disconnectEnvironment(target);
      NodeFS.writeFileSync(socket, "");
      harness.events.length = 0;

      yield* manager.ensureEnvironment(target);

      assert.deepEqual(harness.events, ["control.exit", "master", "launch", "tunnel"]);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });

  it.effect.each([
    [
      "exits",
      { _tag: "exits", stderr: "muxserver_listen: link mux listener: Operation not permitted\n" },
    ],
    ["never opens its socket", { _tag: "silent" }],
  ] as const)("falls back to direct commands for good when the master %s", ([, behavior]) => {
    const harness = makeHarness({ master: () => behavior });
    return Effect.gen(function* () {
      const manager = yield* SshTunnel.SshEnvironmentManager;
      const masterSpawned = harness.nextSpawn("master");
      const first = yield* Effect.forkChild(manager.ensureEnvironment(target));
      if (behavior._tag === "silent") {
        yield* passTimeout(masterSpawned, Duration.seconds(30));
      }
      yield* Fiber.join(first);
      yield* manager.ensureEnvironment(target, { issuePairingToken: true });

      assert.equal(harness.count("master"), 1);
      assert.equal(harness.count("master.kill"), behavior._tag === "silent" ? 1 : 0);
      for (const kind of ["launch", "script", "tunnel"]) {
        for (const entry of harness.argsOf(kind)) {
          assert.deepEqual(optionValues(entry.args, "ControlPath"), ["ControlPath=none"]);
        }
      }
      assert.equal(harness.count("launch"), 1);
      assert.equal(harness.count("script"), 1);
    }).pipe(Effect.provide(harness.layer()), Effect.scoped);
  });
});
