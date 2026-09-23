import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as GitHubAccountSelector from "../sourceControl/GitHubAccountSelector.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { githubToken } from "./GitHubMediaFetch.ts";

const output = (stdout: string) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

it.effect("caches one token per selected account and asks gh for each login", () =>
  Effect.gen(function* () {
    const calls: Array<ReadonlyArray<string>> = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(GitHubCli.GitHubCli)({
        execute: (input) =>
          Effect.sync(() => {
            calls.push(input.args);
            return output(`token-${input.args[5] ?? "active"}\n`);
          }),
      }),
      Layer.mock(GitHubAccountSelector.GitHubAccountSelector)({
        forCheckout: ({ cwd }) =>
          Effect.succeed(
            cwd === "/work"
              ? { host: "github.com", login: "work" }
              : cwd === "/personal"
                ? { host: "github.com", login: "personal" }
                : null,
          ),
      }),
    );
    const read = (cwd: string) =>
      githubToken({ cwd, host: "github.com" }).pipe(Effect.provide(dependencies));

    const work = yield* read("/work");
    const personal = yield* read("/personal");
    const plain = yield* read("/plain");
    yield* read("/work");
    yield* read("/personal");

    assert.strictEqual(Redacted.value(work!), "token-work");
    assert.strictEqual(Redacted.value(personal!), "token-personal");
    assert.strictEqual(Redacted.value(plain!), "token-active");
    assert.deepStrictEqual(calls, [
      ["auth", "token", "--hostname", "github.com", "--user", "work"],
      ["auth", "token", "--hostname", "github.com", "--user", "personal"],
      ["auth", "token", "--hostname", "github.com"],
    ]);
  }),
);
