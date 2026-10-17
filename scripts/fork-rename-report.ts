#!/usr/bin/env node
/**
 * Fork-only. Classifies every `t3` (any case) in the tracked files with the
 * rules in scripts/lib/forkRenameRules.ts and writes a Markdown report: totals
 * per class, each rule's occurrences, and every occurrence no rule covers.
 * Exits non-zero while anything is unclassified, so a sync stops until a
 * person decides what new upstream names mean. It edits nothing.
 *
 *   node scripts/fork-rename-report.ts --output fork-rename-report.md
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

import {
  classifyRenameOccurrence,
  findRenameOccurrences,
  FORK_RENAME_RULES,
  RENAME_CLASS_ACTIONS,
  RENAME_CLASSES,
  type RenameOccurrence,
  type RenameRule,
} from "./lib/forkRenameRules.ts";

export class ForkRenameUnclassifiedError extends Schema.TaggedError<ForkRenameUnclassifiedError>()(
  "ForkRenameUnclassifiedError",
  { occurrences: Schema.Number, groups: Schema.Number, report: Schema.String },
) {
  override get message(): string {
    return `${this.occurrences} t3 occurrence(s) in ${this.groups} group(s) match no rule; see ${this.report}. Add a rule to scripts/lib/forkRenameRules.ts.`;
  }
}

/** Paths the rename never touches: vendored references. */
const IGNORED_PATH = /^\.repos\//;

/** The token without surrounding quotes and punctuation, used to group unclassified hits. */
const groupKey = (occurrence: RenameOccurrence) =>
  occurrence.token.replace(/^["\x27`(]+|["\x27`),;:.]+$/g, "") || occurrence.token;

interface TallyEntry {
  count: number;
  readonly files: Set<string>;
  /** A few `path: line` samples, each from a different file. */
  readonly examples: Array<string>;
}

export interface ForkRenameTally {
  readonly total: number;
  readonly byRule: ReadonlyMap<RenameRule, TallyEntry>;
  readonly unclassified: ReadonlyMap<string, TallyEntry>;
}

const EXAMPLES_PER_GROUP = 3;

const record = <K>(bucket: Map<K, TallyEntry>, key: K, occurrence: RenameOccurrence) => {
  const entry = bucket.get(key) ?? { count: 0, files: new Set<string>(), examples: [] };
  entry.count += 1;
  if (!entry.files.has(occurrence.path) && entry.examples.length < EXAMPLES_PER_GROUP) {
    entry.examples.push(`${occurrence.path}: ${occurrence.line.trim().slice(0, 140)}`);
  }
  entry.files.add(occurrence.path);
  bucket.set(key, entry);
};

/** Classifies every occurrence in `files` (path and text pairs). */
export const tallyForkRename = (
  files: Iterable<readonly [path: string, text: string]>,
  rules: ReadonlyArray<RenameRule> = FORK_RENAME_RULES,
): ForkRenameTally => {
  const byRule = new Map<RenameRule, TallyEntry>();
  const unclassified = new Map<string, TallyEntry>();
  let total = 0;
  for (const [path, text] of files) {
    for (const occurrence of findRenameOccurrences(path, text)) {
      total += 1;
      const rule = classifyRenameOccurrence(rules, occurrence);
      if (rule) record(byRule, rule, occurrence);
      else record(unclassified, groupKey(occurrence), occurrence);
    }
  }
  return { total, byRule, unclassified };
};

const codeSpan = (text: string) => `\`${text.replaceAll("`", "'")}\``;

/** The Markdown report for a tally. */
export const formatForkRenameReport = (tally: ForkRenameTally): string => {
  const unclassifiedCount = [...tally.unclassified.values()].reduce((sum, e) => sum + e.count, 0);
  const lines: Array<string> = [
    "# Fork rename dry run",
    "",
    `${tally.total} occurrences of \`t3\` (any case) in tracked files outside \`.repos/\`. ${tally.total - unclassifiedCount} are classified; ${unclassifiedCount} in ${tally.unclassified.size} groups match no rule.`,
    "",
    "| Class | Occurrences | Rules | What the rename does |",
    "| --- | ---: | ---: | --- |",
  ];
  for (const name of RENAME_CLASSES) {
    const rules = [...tally.byRule].filter(([rule]) => rule.class === name);
    const count = rules.reduce((sum, [, entry]) => sum + entry.count, 0);
    lines.push(`| ${name} | ${count} | ${rules.length} | ${RENAME_CLASS_ACTIONS[name]} |`);
  }
  lines.push(
    `| unclassified | ${unclassifiedCount} | | Stops the rename until a rule covers it |`,
    "",
  );
  for (const name of RENAME_CLASSES) {
    const rules = [...tally.byRule]
      .filter(([rule]) => rule.class === name)
      .toSorted((a, b) => b[1].count - a[1].count);
    if (rules.length === 0) continue;
    lines.push(`## ${name}`, "");
    for (const [rule, entry] of rules) {
      lines.push(
        `### ${rule.id} (${entry.count} in ${entry.files.size} files)`,
        "",
        rule.reason,
        "",
        ...entry.examples.map((example) => `- ${codeSpan(example)}`),
        "",
      );
    }
  }
  if (tally.unclassified.size > 0) {
    lines.push("## unclassified", "");
    for (const [key, entry] of [...tally.unclassified].toSorted(
      (a, b) => b[1].count - a[1].count,
    )) {
      lines.push(
        `### ${codeSpan(key)} (${entry.count} in ${entry.files.size} files)`,
        "",
        ...entry.examples.map((example) => `- ${codeSpan(example)}`),
        "",
      );
    }
  }
  return lines.join("\n");
};

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

/** Tracked files, as repo-relative paths. */
const trackedFiles = Effect.fn("trackedFiles")(function* (repoRoot: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make("git", ["ls-files", "-z"], { cwd: repoRoot }),
  );
  const output = yield* collect(child.stdout);
  return output.split("\0").filter((file) => file !== "" && !IGNORED_PATH.test(file));
}, Effect.scoped);

export const writeForkRenameReport = Effect.fn("writeForkRenameReport")(function* (output: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const decoder = new TextDecoder();
  const texts: Array<readonly [string, string]> = [];
  for (const file of yield* trackedFiles(repoRoot)) {
    const absolute = path.join(repoRoot, file);
    const info = yield* fs.stat(absolute).pipe(Effect.option);
    if (info._tag === "None" || info.value.type !== "File") continue;
    const bytes = yield* fs.readFile(absolute);
    if (bytes.subarray(0, 8192).includes(0)) continue;
    texts.push([file, decoder.decode(bytes)]);
  }
  const tally = tallyForkRename(texts);
  yield* fs.writeFileString(output, formatForkRenameReport(tally));
  const unclassified = [...tally.unclassified.values()].reduce((sum, e) => sum + e.count, 0);
  if (unclassified > 0) {
    return yield* new ForkRenameUnclassifiedError({
      occurrences: unclassified,
      groups: tally.unclassified.size,
      report: output,
    });
  }
  yield* Console.log(`All ${tally.total} t3 occurrences are classified; report in ${output}.`);
});

const command = Command.make(
  "fork-rename-report",
  {
    output: Flag.String("output").pipe(
      Flag.withDescription("Where to write the Markdown report."),
      Flag.withDefault("fork-rename-report.md"),
    ),
  },
  ({ output }) => writeForkRenameReport(output),
).pipe(
  Command.withDescription("Classify every t3 reference for the Lathe rename, editing nothing."),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
