import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ServerInstallation } from "@t3tools/contracts";
import {
  HostProcessArguments,
  HostProcessExecutablePath,
  HostProcessIsExecutable,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
import { FORK_IDENTITY, forkPackageSpec } from "@t3tools/shared/forkIdentity";
import {
  forkCliExecutableNames,
  FORK_NPM_LAUNCHER_SCRIPTS,
} from "@t3tools/shared/forkCliArtifacts";

import packageJson from "../../package.json" with { type: "json" };

export type CliRunner = "npx" | "pnpm dlx" | "bunx";

/**
 * How the CLI was launched, judged by where its entry script lives. Each
 * package runner executes out of a distinctive cache/temp layout:
 *
 *   npx      ~/.npm/_npx/<hash>/node_modules/...
 *   pnpm dlx ~/.cache/pnpm/dlx/..., $PNPM_HOME/.pnpm/dlx/...,
 *            or %LOCALAPPDATA%/pnpm-cache/dlx/... on Windows
 *   bunx     ~/.bun/install/cache/... or $TMPDIR/bunx-<uid>-<spec>/...
 *
 * Global installs and repo checkouts match none of these and return null.
 * Detection is best-effort; callers must fail closed to a plain bare command.
 */
function detectCliRunner(entryPath: string): CliRunner | null {
  const path = entryPath.replaceAll("\\", "/");
  if (path.includes("/_npx/")) {
    return "npx";
  }
  if (
    path.includes("/pnpm/dlx/") ||
    path.includes("/.pnpm/dlx/") ||
    path.includes("/pnpm-cache/dlx/")
  ) {
    return "pnpm dlx";
  }
  if (path.includes("/.bun/install/cache/") || path.includes("/bunx-")) {
    return "bunx";
  }
  return null;
}

const InstallManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  bin: Schema.optionalKey(Schema.Struct({ [FORK_IDENTITY.cliBin]: Schema.String })),
  optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const decodeInstallManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(InstallManifest));

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// `<prefix>/lib/node_modules/<launcher>/` holding the launcher script or a platform executable.
const GLOBAL_INSTALL_ENTRY = new RegExp(
  `^(.*)/lib/node_modules/${escapeRegExp(FORK_IDENTITY.npmPackageName)}/(?:dist/bin\\.mjs|${FORK_NPM_LAUNCHER_SCRIPTS.map(escapeRegExp).join("|")}|node_modules/${escapeRegExp(FORK_IDENTITY.npm.platformPackageScope)}/${escapeRegExp(FORK_IDENTITY.npm.platformPackagePrefix)}[^/]+/(?:${forkCliExecutableNames("linux").map(escapeRegExp).join("|")}))$`,
);

/** Prove the running package and its global bin belong together before suggesting an update. */
export const resolveServerInstallation = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const args = yield* HostProcessArguments;
  const executable = yield* HostProcessIsExecutable;
  const executablePath = yield* HostProcessExecutablePath;
  const platform = yield* HostProcessPlatform;
  const entry = yield* fs.realPath(executable ? executablePath : (args[1] ?? ""));
  const match = GLOBAL_INSTALL_ENTRY.exec(entry);
  if (!match) {
    const runner = detectCliRunner(entry);
    return runner === null
      ? null
      : ({ kind: runner === "pnpm dlx" ? "pnpm-dlx" : runner } satisfies ServerInstallation);
  }
  // A global prefix can contain runner-like names; prove its ownership first.
  // Windows shims and other package managers need their own ownership proof.
  if (platform === "win32") return null;
  const prefix = match[1] || "/";
  if (
    prefix.includes("/node_modules/") ||
    /\/(?:Cellar|Caskroom)\//i.test(prefix) ||
    /\/mise\/installs\/(?!node\/)[^/]+\//.test(prefix)
  )
    return null;

  const packageRoot = path.join(prefix, "lib/node_modules", FORK_IDENTITY.npmPackageName);
  const manifest = yield* fs
    .readFileString(path.join(packageRoot, "package.json"))
    .pipe(Effect.flatMap(decodeInstallManifest));
  if (manifest.name !== FORK_IDENTITY.npmPackageName || !manifest.bin) return null;
  const bin = yield* fs.realPath(path.join(packageRoot, manifest.bin[FORK_IDENTITY.cliBin]));
  const globalBin = yield* fs.realPath(path.join(prefix, "bin", FORK_IDENTITY.cliBin));
  if (globalBin !== bin) return null;
  if (executable) {
    const nativeManifest = yield* fs
      .readFileString(path.join(path.dirname(entry), "package.json"))
      .pipe(Effect.flatMap(decodeInstallManifest));
    if (
      !FORK_NPM_LAUNCHER_SCRIPTS.some(
        (script) => manifest.bin?.[FORK_IDENTITY.cliBin] === `./${script}`,
      ) ||
      manifest.optionalDependencies?.[nativeManifest.name] !== nativeManifest.version ||
      nativeManifest.version !== manifest.version
    )
      return null;
  } else if (bin !== entry) {
    return null;
  }
  return { kind: "npm-global", prefix } satisfies ServerInstallation;
}).pipe(Effect.orElseSucceed(() => null));

/**
 * The package spec to suggest. The literal spec the user typed (e.g. the
 * `@nightly` tag) is resolved away before our process starts, so re-derive it
 * from the running version: nightly builds re-suggest the nightly channel,
 * anything else suggests the bare package.
 */
function suggestedPackageSpec(version: string): string {
  const channel = /^[^-+]+-(nightly|preview)\./.exec(version)?.[1];
  return channel === undefined ? FORK_IDENTITY.npmPackageName : forkPackageSpec(channel);
}

/**
 * Render a `<cli> <subcommand>` suggestion that matches how this process was
 * launched, so copy/pasting it actually works: an npx launch suggests an npx
 * command, a global install suggests the bare CLI, and a nightly build keeps
 * the `@nightly` tag.
 */
export function formatCliCommand(input: {
  readonly subcommand: string;
  readonly entryPath: string;
  readonly version: string;
}): string {
  const runner = detectCliRunner(input.entryPath);
  if (runner === null) {
    return `${FORK_IDENTITY.cliBin} ${input.subcommand}`;
  }
  return `${runner} ${suggestedPackageSpec(input.version)} ${input.subcommand}`;
}

/** `formatCliCommand` against this process's real entry path and version. */
export const resolveCliCommand = (subcommand: string) =>
  Effect.map(HostProcessArguments, (processArguments) =>
    formatCliCommand({
      subcommand,
      entryPath: processArguments[1] ?? "",
      version: packageJson.version,
    }),
  );
