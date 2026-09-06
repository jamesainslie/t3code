import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";
import {
  browserLaunchHelperSource,
  buildBrowserLaunchCommand,
  makeBrowserLaunchStderrHandler,
  preflightBrowserLaunchCommand,
} from "./browserLaunchCapture.ts";

const marker = "__T3_TEST_BROWSER_URL__";
const url =
  "https://example.com/authorize?state=opaque&redirect_uri=http%3A%2F%2F127.0.0.1%3A4567%2F";
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

describe("browser launch command", () => {
  it("keeps the helper source free of Python BROWSER delimiters", () => {
    const source = browserLaunchHelperSource(marker);
    assert.notInclude(source, ":");
    assert.notInclude(source, ";");
  });

  it.effect("quotes the runtime and helper into one BROWSER value", () =>
    Effect.gen(function* () {
      const command = yield* buildBrowserLaunchCommand({
        marker,
        runtimeExecutablePath: "/opt/t3/node",
        platform: "linux",
      });
      assert.equal(command.executable, "/opt/t3/node");
      assert.deepEqual(command.args.slice(0, 1), ["-e"]);
      assert.equal(command.args.at(-1), "%s");
      assert.isTrue(command.command.startsWith("'/opt/t3/node' '-e' '"));
      assert.isTrue(command.command.endsWith("'--' '%s'"));
      assert.notInclude(command.command, ":");
    }),
  );

  it.effect("rejects runtime paths that collide with the platform BROWSER delimiter", () =>
    Effect.gen(function* () {
      for (const [platform, runtimeExecutablePath] of [
        ["linux", "/bad:path/node"],
        ["win32", "C:/bad;path/node.exe"],
      ] as const) {
        const result = yield* buildBrowserLaunchCommand({
          marker,
          runtimeExecutablePath,
          platform,
        }).pipe(Effect.exit);
        assert.isTrue(Exit.isFailure(result), platform);
      }
      const windows = yield* buildBrowserLaunchCommand({
        marker,
        runtimeExecutablePath: "C:\\Program Files\\T3\\node.exe",
        platform: "win32",
      });
      assert.equal(windows.executable, "C:/Program Files/T3/node.exe");
    }),
  );
});

it.layer(NodeServices.layer)("browser launch helper", (it) => {
  const runHelper = Effect.fn("runHelper")(function* (extraArguments: ReadonlyArray<string>) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = yield* buildBrowserLaunchCommand({ marker });
    const child = yield* spawner.spawn(
      ChildProcess.make(
        command.executable,
        [...command.args.filter((argument) => argument !== "%s"), ...extraArguments],
        { shell: false },
      ),
    );
    const [stderr, exitCode] = yield* Effect.all(
      [collectUint8StreamText({ stream: child.stderr, maxBytes: 65_536 }), child.exitCode],
      { concurrency: "unbounded" },
    );
    return { stderr: stderr.text, exitCode: Number(exitCode) };
  });

  it.effect("reports a substituted URL and an appended URL the same way", () =>
    Effect.gen(function* () {
      const substituted = yield* runHelper([url]).pipe(Effect.scoped);
      const appended = yield* runHelper(["%s", url]).pipe(Effect.scoped);
      assert.equal(substituted.exitCode, 0);
      assert.equal(substituted.stderr, `${marker}${encodeJson(url)}\n`);
      assert.deepEqual(appended, substituted);
    }),
  );

  it.effect("preflight passes with the real runtime and fails with a missing one", () =>
    Effect.gen(function* () {
      const command = yield* buildBrowserLaunchCommand({ marker });
      yield* preflightBrowserLaunchCommand(command, {});
      const missing = yield* buildBrowserLaunchCommand({
        marker,
        runtimeExecutablePath: "/nonexistent/t3-runtime",
        platform: "linux",
      });
      const result = yield* preflightBrowserLaunchCommand(missing, {}).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
    }),
  );
});

describe("browser launch stderr handler", () => {
  it.effect("reassembles a fragmented marker line and ignores surrounding stderr", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const handle = makeBrowserLaunchStderrHandler({
        marker,
        onUrl: (value) => Effect.sync(() => void urls.push(value)),
      });
      const line = `${marker}${encodeJson(url)}\n`;
      yield* handle(`native log\n${line.slice(0, 12)}`);
      yield* handle(line.slice(12, 40));
      yield* handle(`${line.slice(40)}another native log\r\n`);
      assert.deepEqual(urls, [url]);
    }),
  );

  it.effect("drops malformed and similar lines without failing", () =>
    Effect.gen(function* () {
      const urls: string[] = [];
      const handle = makeBrowserLaunchStderrHandler({
        marker,
        onUrl: (value) => Effect.sync(() => void urls.push(value)),
      });
      yield* handle(` ${marker}${encodeJson(url)}\n`);
      yield* handle(`${marker}${url}\n`);
      yield* handle(`${marker}${encodeJson(42)}\n`);
      yield* handle(`${marker}${encodeJson("x".repeat(20_000))}\n`);
      assert.deepEqual(urls, []);
    }),
  );

  it.effect("preserves the flow owner's failure and reads an extra native line format", () =>
    Effect.gen(function* () {
      const failure = new Error("flow stopped");
      const handle = makeBrowserLaunchStderrHandler({
        marker,
        onUrl: () => Effect.fail(failure),
        readLine: (line) => (line.startsWith("Open: ") ? line.slice("Open: ".length) : undefined),
      });
      const fromMarker = yield* handle(`${marker}${encodeJson(url)}\n`).pipe(Effect.flip);
      assert.equal(fromMarker, failure);
      const fromNative = yield* handle(`Open: ${url}\n`).pipe(Effect.flip);
      assert.equal(fromNative, failure);
    }),
  );
});
