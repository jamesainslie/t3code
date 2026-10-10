import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as GitHubCredentials from "@t3tools/source-control-github/server/GitHubCredentials";

import * as GitHubAccountSelector from "../sourceControl/GitHubAccountSelector.ts";
import { githubToken } from "./GitHubMediaFetch.ts";

it.effect("reads media as the checkout's selected account, else as the host's credential", () =>
  Effect.gen(function* () {
    const hostReads: string[] = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(GitHubCredentials.GitHubCredentials)({
        get: (host) =>
          Effect.sync(() => {
            hostReads.push(host);
            return {
              host,
              token: Redacted.make("token-active"),
              source: "gh" as const,
              fingerprint: `${host}:active`,
            };
          }),
      }),
      Layer.mock(GitHubAccountSelector.GitHubAccountSelector)({
        pinFor: ({ cwd }) =>
          Effect.succeed(
            cwd === "/plain"
              ? null
              : {
                  host: cwd === "/enterprise" ? "github.example.test" : "github.com",
                  token: Redacted.make(`token-${cwd.slice(1)}`),
                  credentialFingerprint: cwd,
                },
          ),
      }),
    );
    const read = (cwd: string) =>
      githubToken(cwd).pipe(
        Effect.map((token) => (token === null ? null : Redacted.value(token))),
        Effect.provide(dependencies),
      );

    assert.strictEqual(yield* read("/work"), "token-work");
    assert.strictEqual(yield* read("/personal"), "token-personal");
    assert.strictEqual(yield* read("/plain"), "token-active");
    // A pin for another host never authorizes github.com media.
    assert.strictEqual(yield* read("/enterprise"), "token-active");
    assert.deepStrictEqual(hostReads, ["github.com", "github.com"]);
  }),
);
