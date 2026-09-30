import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import { SshCommandError, SshPasswordPromptError } from "@t3tools/ssh/errors";
import { SshOutputObserver } from "@t3tools/ssh/output";
import * as SshTunnel from "@t3tools/ssh/tunnel";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopSshEnvironment from "./DesktopSshEnvironment.ts";
import * as DesktopSshOutputLog from "./DesktopSshOutputLog.ts";
import * as DesktopSshPasswordPrompts from "./DesktopSshPasswordPrompts.ts";

function makeTempHomeDir() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-env-test-" });
  });
}

describe("sshEnvironment", () => {
  it("keeps prompt presentation diagnostics distinct from the legacy wrapper message", () => {
    const cause = new DesktopSshPasswordPrompts.DesktopSshPromptPresentationError({
      requestId: "prompt-1",
      destination: "devbox",
      operation: "send-prompt-request",
      cause: new Error("renderer send failed"),
    });

    assert.equal(cause.message, "Failed to present SSH password prompt for devbox.");
    assert.equal(
      DesktopSshEnvironment.toSshPasswordPromptError(cause).message,
      "T3 Code window is not available for SSH authentication.",
    );
  });

  it("treats password prompt timeouts as cancellable authentication prompts", () => {
    assert.equal(
      DesktopSshEnvironment.isDesktopSshPasswordPromptCancellation(
        new SshPasswordPromptError({
          message: "SSH authentication timed out for devbox.",
          cause: new DesktopSshPasswordPrompts.DesktopSshPromptTimedOutError({
            requestId: "prompt-1",
            destination: "devbox",
          }),
        }),
      ),
      true,
    );
  });

  it.effect("wires desktop host discovery through the ssh package runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* makeTempHomeDir();
      const sshDir = path.join(homeDir, ".ssh");
      yield* fs.makeDirectory(path.join(sshDir, "config.d"), { recursive: true });
      yield* fs.writeFileString(
        path.join(sshDir, "config"),
        ["Host devbox", "  HostName devbox.example.com", "Include config.d/*.conf", ""].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(sshDir, "config.d", "team.conf"),
        [
          "Host staging",
          "  HostName staging.example.com",
          "Host *",
          "  ServerAliveInterval 30",
          "",
        ].join("\n"),
      );
      yield* fs.writeFileString(
        path.join(sshDir, "known_hosts"),
        [
          "known.example.com ssh-ed25519 AAAA",
          "|1|hashed|entry ssh-ed25519 AAAA",
          "[bastion.example.com]:2222 ssh-ed25519 AAAA",
          "",
        ].join("\n"),
      );

      const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
      const hosts = yield* sshEnvironment.discoverHosts({ homeDir });
      assert.deepEqual(hosts, [
        {
          alias: "bastion.example.com",
          hostname: "bastion.example.com",
          username: null,
          port: null,
          source: "known-hosts",
        },
        {
          alias: "devbox",
          hostname: "devbox",
          username: null,
          port: null,
          source: "ssh-config",
        },
        {
          alias: "known.example.com",
          hostname: "known.example.com",
          username: null,
          port: null,
          source: "known-hosts",
        },
        {
          alias: "staging",
          hostname: "staging",
          username: null,
          port: null,
          source: "ssh-config",
        },
      ]);
    }).pipe(
      Effect.provide(
        DesktopSshEnvironment.layer().pipe(
          Layer.provideMerge(Layer.mock(ElectronWindow.ElectronWindow)({})),
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
      Effect.scoped,
    ),
  );

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
          ["launch", "installing t3 1.2.3"],
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
                    text: "installing t3 1.2.3\n",
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
