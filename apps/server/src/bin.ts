/**
 * Thin CLI entry.
 *
 * Commands that other processes spawn on hot paths (ACP bridges, the SSH
 * launch script's `--version` and `__ssh-helper` calls) dispatch in
 * ./cliEntry.ts before the full CLI module graph (seconds of evaluation)
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
  await runCliEntry(process.argv.slice(2));
}
