/**
 * Commands that other processes spawn on hot paths (ACP bridges, the SSH launch script's
 * `--version` and `__ssh-helper` calls, Codex's managed-token helper) dispatch before the full
 * CLI module graph (seconds of evaluation) loads; everything else defers to ./binCli.ts.
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
  if (args[0] === "__document-text") {
    const { extractDocumentText } = await import("./provider/documentTextWorker.ts");
    try {
      process.stdout.write(await extractDocumentText(args[1]!, args[2]!));
    } catch (error) {
      if (error instanceof Error && "code" in error && /^E[A-Z0-9]+$/.test(String(error.code))) {
        throw error;
      }
      // Exit 2 identifies document rejections; OS and process failures remain retryable.
      process.exitCode = 2;
    }
  } else if (args[0] === "__managed-chatgpt-token") {
    const { runManagedChatGptTokenCli } = await import("./cli/managedChatGptToken.ts");
    await runManagedChatGptTokenCli(args.slice(1));
  } else {
    await runCliEntry(args);
  }
}
