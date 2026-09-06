import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import {
  browserLaunchWrapperScript,
  makeBrowserLaunchSocket,
  parseBrowserLaunchMessage,
} from "./browserLaunchSocket.ts";

const url = "https://github.com/login/device?user_code=ABCD-1234";

describe("browser launch socket protocol", () => {
  it("parses a token and URL pair and rejects anything else", () => {
    assert.deepEqual(parseBrowserLaunchMessage(`${"a".repeat(32)}\n${url}\n`), {
      token: "a".repeat(32),
      url,
    });
    for (const message of [
      "",
      `${"a".repeat(32)}\n`,
      `${"a".repeat(32)}\n${url}`,
      `short\n${url}\n`,
      `${"a".repeat(32)}\n\n`,
      `${"a".repeat(32)}\nhttps://example.com/a b\n`,
    ]) {
      assert.isNull(parseBrowserLaunchMessage(message), message);
    }
  });

  it("quotes the runtime path in the POSIX wrapper", () => {
    const script = browserLaunchWrapperScript({
      platform: "linux",
      runtimeExecutablePath: '/opt/T3 "Code"/node',
      helperPath: "/state/auth-relay/browser-launch.mjs",
      address: "/tmp/t3.sock",
    });
    assert.include(script, 'ELECTRON_RUN_AS_NODE=1 exec "/opt/T3 \\"Code\\"/node"');
    assert.include(script, '"$@"');
  });
});

it.layer(NodeServices.layer)("browser launch socket", (it) => {
  const runWrapper = Effect.fn("runWrapper")(function* (
    command: string,
    launchArguments: ReadonlyArray<string>,
  ) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    // Launchers like gh split BROWSER shell-style and append the URL.
    const [wrapper, token] = command
      .split(" ")
      .map((part) => part.slice(1, -1).replaceAll(`'"'"'`, "'"));
    const child = yield* spawner.spawn(
      ChildProcess.make(wrapper!, [token!, ...launchArguments], { shell: false }),
    );
    const [stderr, exitCode] = yield* Effect.all(
      [collectUint8StreamText({ stream: child.stderr, maxBytes: 65_536 }), child.exitCode],
      { concurrency: "unbounded" },
    );
    return { stderr: stderr.text, exitCode: Number(exitCode) };
  });

  // The wrapper is a POSIX shell script; the Windows .cmd wrapper is exercised by hand.
  it.effect("delivers a launched URL to the registered terminal and stays silent", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      if (platform === "win32") return;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-browser-launch-" });
      {
        const socket = yield* makeBrowserLaunchSocket({
          directory: path.join(directory, "auth-relay"),
          address: path.join(directory, "relay.sock"),
          platform,
        });
        const received = yield* Deferred.make<string>();
        const registration = yield* socket.register((value) =>
          Deferred.succeed(received, value).pipe(Effect.asVoid),
        );

        const appended = yield* runWrapper(registration.command, [url]).pipe(Effect.scoped);
        assert.deepEqual(appended, { stderr: "", exitCode: 0 });
        assert.equal(yield* Deferred.await(received), url);

        const substituted = yield* runWrapper(registration.command, ["%s", url]).pipe(
          Effect.scoped,
        );
        assert.deepEqual(substituted, { stderr: "", exitCode: 0 });

        yield* registration.release;
        const released = yield* runWrapper(registration.command, [url]).pipe(Effect.scoped);
        assert.equal(released.exitCode, 0);
        assert.include(released.stderr, url);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("prints the URL to the terminal when no relay is listening", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      if (platform === "win32") return;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-browser-launch-" });
      {
        const scope = yield* Scope.make();
        const socket = yield* makeBrowserLaunchSocket({
          directory: path.join(directory, "auth-relay"),
          address: path.join(directory, "relay.sock"),
          platform,
        }).pipe(Scope.provide(scope));
        const registration = yield* socket.register(() => Effect.void);
        yield* Scope.close(scope, Exit.void);
        const result = yield* runWrapper(registration.command, [url]).pipe(Effect.scoped);
        assert.equal(result.exitCode, 0);
        assert.include(result.stderr, url);
      }
    }).pipe(Effect.scoped),
  );
});
