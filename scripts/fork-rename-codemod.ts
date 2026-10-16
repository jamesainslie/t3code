#!/usr/bin/env node
/**
 * Fork-only. Applies the Lathe rename (scripts/lib/forkRenameCodemod.ts) to
 * every tracked file outside `.repos/`: file contents first, then paths with
 * `git mv`. Without `--write` it only reports what it would change. Refuses
 * to run while any `t3` occurrence is unclassified, and when two paths would
 * rename to the same place.
 *
 *   node scripts/fork-rename-codemod.ts           # dry run
 *   node scripts/fork-rename-codemod.ts --write   # rename the working tree
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { renameForkPath, renameForkText } from "./lib/forkRenameCodemod.ts";

export class ForkRenamePathCollisionError extends Schema.TaggedError<ForkRenamePathCollisionError>()(
  "ForkRenamePathCollisionError",
  { collisions: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return `Renamed paths collide:\n  ${this.collisions.join("\n  ")}`;
  }
}

export class ForkRenameGitError extends Schema.TaggedError<ForkRenameGitError>()(
  "ForkRenameGitError",
  { command: Schema.String, exitCode: Schema.Int },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

const IGNORED_PATH = /^\.repos\//;

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const git = Effect.fn("git")(function* (repoRoot: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd: repoRoot }));
  const [output, exitCode] = yield* Effect.all([collect(child.stdout), child.exitCode], {
    concurrency: "unbounded",
  });
  if (Number(exitCode) !== 0) {
    return yield* new ForkRenameGitError({
      command: `git ${args.join(" ")}`,
      exitCode: Number(exitCode),
    });
  }
  return output;
}, Effect.scoped);

export const runForkRenameCodemod = Effect.fn("runForkRenameCodemod")(function* (write: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const files = (yield* git(repoRoot, ["ls-files", "-z"]))
    .split("\0")
    .filter((file) => file !== "" && !IGNORED_PATH.test(file));
  const decoder = new TextDecoder("utf-8", { fatal: false });
  // Every change is computed before anything is written, so a refusal never
  // leaves the tree half renamed.
  const rewrites: Array<readonly [absolute: string, text: string]> = [];
  let edits = 0;
  for (const file of files) {
    const absolute = path.join(repoRoot, file);
    const info = yield* fs.stat(absolute).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") continue;
    const bytes = yield* fs.readFile(absolute);
    if (bytes.subarray(0, 8192).includes(0)) continue;
    const renamed = renameForkText(file, decoder.decode(bytes));
    if (renamed.edits === 0) continue;
    rewrites.push([absolute, renamed.text]);
    edits += renamed.edits;
  }
  const changedFiles = rewrites.length;
  const moves = files
    .map((file) => [file, renameForkPath(file)] as const)
    .filter(([from, to]) => from !== to);
  const targets = new Map<string, string>();
  const collisions: Array<string> = [];
  const existing = new Set(files);
  for (const [from, to] of moves) {
    const other = targets.get(to);
    if (other !== undefined) collisions.push(`${other} and ${from} -> ${to}`);
    else if (existing.has(to)) collisions.push(`${from} -> ${to}, which already exists`);
    targets.set(to, from);
  }
  if (collisions.length > 0) return yield* new ForkRenamePathCollisionError({ collisions });
  if (write) {
    for (const [absolute, text] of rewrites) yield* fs.writeFileString(absolute, text);
    for (const [from, to] of moves) {
      yield* fs.makeDirectory(path.dirname(path.join(repoRoot, to)), { recursive: true });
      yield* git(repoRoot, ["mv", from, to]);
    }
  }
  yield* Console.log(
    `${write ? "Renamed" : "Would rename"} ${edits} occurrences in ${changedFiles} files and move ${moves.length} paths.`,
  );
  if (!write) for (const [from, to] of moves) yield* Console.log(`  ${from} -> ${to}`);
});

const command = Command.make(
  "fork-rename-codemod",
  {
    write: Flag.Boolean("write").pipe(
      Flag.withDescription("Rewrite the working tree instead of reporting."),
      Flag.withDefault(false),
    ),
  },
  ({ write }) => runForkRenameCodemod(write),
).pipe(Command.withDescription("Rename the fork's t3 references to Lathe values."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
