import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NetService from "@lathe/shared/Net";
import { SshCommandError } from "@lathe/ssh/errors";
import { SshOutputObserver } from "@lathe/ssh/output";
import * as SshTunnel from "@lathe/ssh/tunnel";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopSshEnvironment from "./DesktopSshEnvironment.ts";
import * as DesktopSshOutputLog from "./DesktopSshOutputLog.ts";
import * as DesktopSshPasswordPrompts from "./DesktopSshPasswordPrompts.ts";

// Fork: the per-environment SSH output log.
describe("sshEnvironment", () => {
  it.effect("records each attempt's output between its start and outcome", () => {
    const target = { alias: "devbox", hostname: "devbox.example.com", username: null, port: null };
    return Effect.gen(function* () {
      const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const log = yield* DesktopSshOutputLog.DesktopSshOutputLog;

      const failure = yield* Effect.flip(sshEnvironment.ensureEnvironment(target));
      assert.equal(failure.message, "SSH command timed out after 90000ms.");

      const { entries } = yield* log.subscribe(target);
      assert.deepEqual(
        entries.map((entry) => [entry.source, entry.text]),
        [
          ["status", "Connecting to devbox"],
          ["launch", "installing lathe 1.2.3"],
          ["status", "Failed: SSH command timed out after 90000ms."],
        ],
      );
    }).pipe(
      Effect.provide(
        Layer.effect(DesktopSshEnvironment.DesktopSshEnvironment, DesktopSshEnvironment.make).pipe(
          Layer.provideMerge(
            Layer.mock(SshTunnel.SshEnvironmentManager)({
              ensureEnvironment: () =>
                Effect.gen(function* () {
                  const observe = yield* SshOutputObserver;
                  yield* observe({
                    source: "launch",
                    stream: "stderr",
                    text: "installing lathe 1.2.3\n",
                  });
                  return yield* new SshCommandError({
                    command: ["ssh"],
                    exitCode: null,
                    stderr: "",
                    timedOut: true,
                    message: "SSH command timed out after 90000ms.",
                  });
                }),
            }),
          ),
          Layer.provideMerge(
            DesktopSshOutputLog.layer.pipe(
              Layer.provide(
                Layer.mock(ElectronWindow.ElectronWindow)({ sendAll: () => Effect.void }),
              ),
            ),
          ),
          Layer.provideMerge(
            Layer.succeed(DesktopSshPasswordPrompts.DesktopSshPasswordPrompts, {
              request: () => Effect.die("unexpected password prompt request"),
              resolve: () => Effect.die("unexpected password prompt resolution"),
            }),
          ),
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(NodeHttpClient.layerUndici),
          Layer.provideMerge(NetService.layer),
        ),
      ),
    );
  });
});
