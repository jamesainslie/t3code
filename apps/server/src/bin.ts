/**
 * Thin CLI entry.
 *
 * Commands that other processes spawn on hot paths (ACP bridges, the SSH
 * launch script's `--version` and `__ssh-helper` calls, Codex's managed-token
 * helper) dispatch before the full CLI module graph (seconds of evaluation)
 * loads; everything else defers to the real CLI in ./binCli.ts.
 */
import "./forkLegacyEnvBoot.ts";
import { runCliEntry } from "./cliEntry.ts";
import { isEntrypoint } from "./entrypoint.ts";

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  // Guard sockets before either dispatch path can load outbound-capable modules.
  const { ignoreMacosTypeOfServiceEinval } = await import("./outboundHttp.ts");
  ignoreMacosTypeOfServiceEinval();
  const args = process.argv.slice(2);
  if (args[0] === "__managed-chatgpt-token") {
    const { runManagedChatGptTokenCli } = await import("./cli/managedChatGptToken.ts");
    await runManagedChatGptTokenCli(args.slice(1));
  } else {
    await runCliEntry(args);
  }
}
