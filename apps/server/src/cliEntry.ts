import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import packageJson from "../package.json" with { type: "json" };

/**
 * Routes CLI arguments before the full CLI module graph (seconds of
 * evaluation) loads. Hot paths that other processes spawn repeatedly run
 * here: every ACP agent spawns `acp-mcp-bridge` while opening its session,
 * terminal-fallback agents run `acp-mcp-call` per tool call, and the SSH
 * launch script runs `--version` and several `__ssh-helper` calls per
 * reconnect. Everything else, including any argument shape a fast path does
 * not recognise, defers to the real CLI in ./binCli.ts so its output stays
 * the single source of truth.
 */
export interface CliEntryLoaders {
  readonly fullCli: () => Promise<{ readonly runCli: () => void }>;
  readonly acpMcp: () => Promise<{
    readonly runAcpMcpCliFastPath: (
      command: "acp-mcp-bridge" | "acp-mcp-call",
      args: ReadonlyArray<string>,
    ) => Promise<void>;
  }>;
  readonly sshHelper: () => Promise<{
    readonly matchSshHelperFastPath: (
      args: ReadonlyArray<string>,
    ) => (() => Promise<void>) | undefined;
  }>;
}

export const cliEntryLoaders: CliEntryLoaders = {
  fullCli: () => import("./binCli.ts"),
  acpMcp: () => import("./mcp/AcpMcpStdioBridge.ts"),
  sshHelper: () => import("./cli/sshHelperFastPath.ts"),
};

export const runCliEntry = async (
  args: ReadonlyArray<string>,
  {
    loaders = cliEntryLoaders,
    stdoutIsTty = process.stdout.isTTY === true,
  }: { readonly loaders?: CliEntryLoaders; readonly stdoutIsTty?: boolean } = {},
) => {
  const [command] = args;
  if (command === "acp-mcp-bridge" || command === "acp-mcp-call") {
    const { runAcpMcpCliFastPath } = await loaders.acpMcp();
    await runAcpMcpCliFastPath(command, args.slice(1));
    return;
  }
  // effect/cli prints `<name> v<version>` and colors it only on a TTY, which
  // stays on the full CLI. The launch script always captures the output.
  if (command === "--version" && args.length === 1 && !stdoutIsTty) {
    process.stdout.write(`${FORK_IDENTITY.cliBin} v${packageJson.version}\n`);
    return;
  }
  if (command === "__ssh-helper") {
    const { matchSshHelperFastPath } = await loaders.sshHelper();
    const run = matchSshHelperFastPath(args.slice(1));
    if (run !== undefined) {
      await run();
      return;
    }
  }
  const { runCli } = await loaders.fullCli();
  runCli();
};
