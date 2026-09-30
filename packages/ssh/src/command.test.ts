import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  baseSshArgs,
  getLastNonEmptyOutputLine,
  parseSshResolveOutput,
  redactSshOutput,
  runSshCommand,
} from "./command.ts";
import { SshCommandError } from "./errors.ts";
import { SshOutputObserver, type SshOutputChunk } from "./output.ts";

const encoder = new TextEncoder();

const makeFailedProcess = (input: { readonly stdout: string; readonly stderr?: string }) => {
  const stdoutStream = Stream.make(encoder.encode(input.stdout));
  const stderrStream = input.stderr ? Stream.make(encoder.encode(input.stderr)) : Stream.empty;
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: stdoutStream,
    stderr: stderrStream,
    all: Stream.empty,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

const makeNeverFinishingProcess = (stderr: Stream.Stream<Uint8Array> = Stream.empty) => {
  let finish: ((exitCode: ChildProcessSpawner.ExitCode) => void) | null = null;
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(123),
    stdout: Stream.empty,
    stderr,
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
        finish?.(ChildProcessSpawner.ExitCode(143));
      }),
    stdin: Sink.drain,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
};

describe("ssh command", () => {
  it.effect("parses resolved ssh config output into a target", () =>
    Effect.sync(() => {
      assert.deepEqual(
        parseSshResolveOutput(
          "devbox",
          ["hostname devbox.example.com", "user julius", "port 2222", ""].join("\n"),
        ),
        {
          alias: "devbox",
          hostname: "devbox.example.com",
          username: "julius",
          port: 2222,
        },
      );
    }),
  );

  it.effect("builds interactive ssh args without forcing batch mode", () =>
    Effect.sync(() => {
      assert.deepEqual(
        baseSshArgs(
          {
            alias: "devbox",
            hostname: "devbox.example.com",
            username: "julius",
            port: 2222,
          },
          { batchMode: "no" },
        ),
        ["-o", "BatchMode=no", "-o", "ConnectTimeout=10", "-p", "2222"],
      );
    }),
  );

  it.effect("reads the last non-empty ssh output line", () =>
    Effect.sync(() => {
      assert.equal(
        getLastNonEmptyOutputLine(
          ["Welcome to the host", "", '{"credential":"pairing-token"}', ""].join("\n"),
        ),
        '{"credential":"pairing-token"}',
      );
    }),
  );

  it.effect("includes stdout in non-zero command failures when stderr is empty", () => {
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(makeFailedProcess({ stdout: "Pairing token creation failed\n" })),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.mergeAll(NodeServices.layer, spawnerLayer);

    return Effect.gen(function* () {
      const result = yield* Effect.result(
        runSshCommand(
          {
            alias: "devbox",
            hostname: "devbox.example.com",
            username: "julius",
            port: 2222,
          },
          { remoteCommandArgs: ["sh", "-s"] },
        ),
      );

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, SshCommandError);
        assert.equal(result.failure.message, "Pairing token creation failed");
        assert.equal(result.failure.stdout, "Pairing token creation failed\n");
        assert.equal(result.failure.stderr, "");
      }
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("redacts credentials from stdout in non-zero command failures", () => {
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(makeFailedProcess({ stdout: '{"credential":"pairing-secret"}\n' })),
    );
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.mergeAll(NodeServices.layer, spawnerLayer);

    return Effect.gen(function* () {
      const result = yield* Effect.result(
        runSshCommand(
          {
            alias: "devbox",
            hostname: "devbox.example.com",
            username: "julius",
            port: 2222,
          },
          { remoteCommandArgs: ["sh", "-s"] },
        ),
      );

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.instanceOf(result.failure, SshCommandError);
        assert.equal(result.failure.message, '{"credential":"[redacted]"}');
        assert.equal(result.failure.stdout, '{"credential":"[redacted]"}\n');
      }
    }).pipe(Effect.provide(processLayer));
  });

  it.effect("fails commands that never finish", () => {
    const spawner = ChildProcessSpawner.make(() => Effect.succeed(makeNeverFinishingProcess()));
    const spawnerLayer = Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner);
    const processLayer = Layer.mergeAll(NodeServices.layer, spawnerLayer, TestClock.layer());

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.result(
          runSshCommand(
            {
              alias: "devbox",
              hostname: "devbox.example.com",
              username: "julius",
              port: 2222,
            },
            { timeoutMs: 1 },
          ),
        ),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust(Duration.millis(1));

      const result = yield* Fiber.join(fiber);

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.include(result.failure.message, "SSH command timed out after 1ms.");
      }
    }).pipe(Effect.provide(processLayer));
  });

  const target = { alias: "devbox", hostname: "devbox.example.com", username: null, port: null };

  const observing = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
    const chunks: Array<SshOutputChunk> = [];
    return {
      chunks,
      run: effect.pipe(
        Effect.provideService(SshOutputObserver, (chunk) =>
          Effect.sync(() => {
            chunks.push(chunk);
          }),
        ),
      ),
    };
  };

  it.effect(
    "reports output as it arrives, so a command that times out keeps what it printed",
    () => {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.succeed(
          makeNeverFinishingProcess(
            Stream.concat(Stream.make(encoder.encode("waiting for server\n")), Stream.never),
          ),
        ),
      );
      const processLayer = Layer.mergeAll(
        NodeServices.layer,
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
        TestClock.layer(),
      );

      return Effect.gen(function* () {
        const { chunks, run } = observing(
          Effect.result(runSshCommand(target, { timeoutMs: 1, observe: { source: "launch" } })),
        );
        const fiber = yield* Effect.forkChild(run);
        yield* Effect.yieldNow;
        yield* TestClock.adjust(Duration.millis(1));
        const result = yield* Fiber.join(fiber);

        assert.deepEqual(chunks, [
          { source: "launch", stream: "stderr", text: "waiting for server\n" },
        ]);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.isTrue(result.failure._tag === "SshCommandError" && result.failure.timedOut);
        }
      }).pipe(Effect.provide(processLayer));
    },
  );

  it.effect("observes only what the caller opts into, and stdout only when asked", () => {
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        makeFailedProcess({ stdout: '{"credential":"secret"}\n', stderr: "denied\n" }),
      ),
    );
    const processLayer = Layer.mergeAll(
      NodeServices.layer,
      Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return Effect.gen(function* () {
      const unobserved = observing(Effect.result(runSshCommand(target)));
      yield* unobserved.run;
      assert.deepEqual(unobserved.chunks, []);

      const stderrOnly = observing(
        Effect.result(runSshCommand(target, { observe: { source: "launch" } })),
      );
      yield* stderrOnly.run;
      assert.deepEqual(stderrOnly.chunks, [
        { source: "launch", stream: "stderr", text: "denied\n" },
      ]);

      const both = observing(
        Effect.result(runSshCommand(target, { observe: { source: "remote-log", stdout: true } })),
      );
      yield* both.run;
      assert.sameDeepMembers(both.chunks, [
        { source: "remote-log", stream: "stdout", text: '{"credential":"secret"}\n' },
        { source: "remote-log", stream: "stderr", text: "denied\n" },
      ]);
    }).pipe(Effect.provide(processLayer));
  });

  it("redacts tokens in JSON fields and pairing links", () => {
    assert.equal(
      redactSshOutput(
        '{"pairingToken":"abc123"} pairingUrl: http://localhost:5733/pair#token=E5YZ6LG6 and https://h/x?a=1&access_token=Q9&b=2',
      ),
      '{"pairingToken":"[redacted]"} pairingUrl: http://localhost:5733/pair#token=[redacted] and https://h/x?a=1&access_token=[redacted]&b=2',
    );
  });
});
