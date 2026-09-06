import {
  ProviderSetupError,
  type ClaudeSettings,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { buildBrowserLaunchCommand } from "../../auth-relay/browserLaunchCapture.ts";
import { CLAUDE_AUTH_BROWSER_MARKER, type ClaudeLoginProcess } from "../ClaudeAuth.ts";
import { makeClaudeEnvironment } from "../Drivers/ClaudeHome.ts";
import { spawnAndCollect } from "../providerSnapshot.ts";

const LOGOUT_TIMEOUT = "30 seconds";

/**
 * `claude auth login` and `claude auth logout` for one instance, run against
 * its `CLAUDE_CONFIG_DIR`. `BROWSER` points at the stderr capture helper so a
 * version that opens a browser reports the URL instead; a runtime that cannot
 * host the helper still logs in, from the URL the CLI prints.
 */
export const makeClaudeLoginCommands = Effect.fn("makeClaudeLoginCommands")(function* (
  instanceId: ProviderInstanceId,
  settings: ClaudeSettings,
  baseEnv: NodeJS.ProcessEnv,
): Effect.fn.Return<
  {
    readonly spawnLogin: Effect.Effect<
      ClaudeLoginProcess,
      ProviderSetupError,
      ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
    >;
    readonly runLogout: Effect.Effect<
      void,
      ProviderSetupError,
      ChildProcessSpawner.ChildProcessSpawner
    >;
  },
  never,
  Path.Path
> {
  const setupError = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId, operation, detail });
  const environment = yield* makeClaudeEnvironment(settings, baseEnv);
  const browser = yield* buildBrowserLaunchCommand({ marker: CLAUDE_AUTH_BROWSER_MARKER }).pipe(
    Effect.option,
  );
  const loginEnvironment = {
    ...environment,
    ...(browser._tag === "Some" ? { BROWSER: browser.value.command } : {}),
  };

  const spawnLogin = Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, ["auth", "login"], {
      env: loginEnvironment,
    });
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          env: loginEnvironment,
          shell: spawnCommand.shell,
          forceKillAfter: "2 seconds",
        }),
      )
      .pipe(
        Effect.mapError(() =>
          setupError("start", "Could not start `claude auth login` on this environment."),
        ),
      );
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      writeStdin: (text: string) => Stream.run(Stream.encodeText(Stream.make(text)), child.stdin),
      exitCode: child.exitCode.pipe(Effect.map(Number)),
    } satisfies ClaudeLoginProcess;
  });

  const runLogout = Effect.gen(function* () {
    const spawnCommand = yield* resolveSpawnCommand(settings.binaryPath, ["auth", "logout"], {
      env: environment,
    });
    const result = yield* spawnAndCollect(
      settings.binaryPath,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: LOGOUT_TIMEOUT,
        orElse: () => Effect.fail(setupError("logout", "Claude sign-out timed out.")),
      }),
      Effect.mapError((error) =>
        error._tag === "ProviderSetupError"
          ? error
          : setupError("logout", "Could not run `claude auth logout` on this environment."),
      ),
    );
    if (result.code !== 0) {
      return yield* setupError("logout", "Claude sign-out failed. Try again.");
    }
  });

  return { spawnLogin, runLogout };
});
