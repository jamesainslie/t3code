import { FORK_IDENTITY } from "@lathe/shared/forkIdentity";
import packageJson from "../package.json" with { type: "json" };

/**
 * Routes CLI arguments before the full CLI module graph (seconds of evaluation) loads, for hot
 * paths other processes spawn repeatedly: `acp-mcp-bridge`, `acp-mcp-call`, `--version` and
 * `__ssh-helper`. Anything else, including an argument shape a fast path does not recognise,
 * defers to ./binCli.ts so the real CLI's output stays the single source of truth.
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
  fullCli: async () => {
    // Before anything reads stdin: the desktop app's Windows launcher starts
    // the CLI without one. Never for the fast paths, whose stdin is a pipe.
    const { attachConsoleStdin } = await import("./cli/consoleStdin.ts");
    attachConsoleStdin();
    return import("./binCli.ts");
  },
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
