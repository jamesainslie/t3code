#!/usr/bin/env node
/**
 * Fork-only. Fails when built output still says "T3 Code" outside the brand
 * layer's exceptions (scripts/lib/forkBrand.ts), naming the file, position and
 * context of each leak. Source maps are skipped: they carry the original
 * source by design. So are binaries and JavaScript comments.
 *
 *   node scripts/brand-leak-check.ts apps/web/dist apps/server/dist apps/desktop/dist-electron
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";
import { parseSync } from "vite-plus";

import { brandTextSites, FORK_BRAND_EXCEPTIONS, FORK_BRAND_TOKEN } from "./lib/forkBrand.ts";

/**
 * The start of upstream's T3 wordmark outline (its `T3Wordmark.tsx`, removed in the fork), its T
 * crossbar. Drawn beside a separate "Code" it says "T3 Code" without the string ever appearing.
 */
export const T3_WORDMARK_OUTLINE = "M33.4509 93V47.56";

export interface BrandLeakAllowlist {
  /** Text that may surround the token, matched at the token's position. */
  readonly phrases: ReadonlyArray<string>;
  /** Object key paths whose string value may be exactly the token. */
  readonly propertyPaths: ReadonlyArray<ReadonlyArray<string>>;
}

export interface BrandLeak {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly context: string;
}

export class BrandLeaksFoundError extends Schema.TaggedError<BrandLeaksFoundError>()(
  "BrandLeaksFoundError",
  {
    leaks: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        line: Schema.Number,
        column: Schema.Number,
        context: Schema.String,
      }),
    ),
  },
) {
  override get message(): string {
    const lines = this.leaks.map(
      (leak) => `  ${leak.file}:${leak.line}:${leak.column}  ${leak.context}`,
    );
    return `Built output still says "${FORK_BRAND_TOKEN}" or draws the T3 wordmark in ${this.leaks.length} place(s):\n${lines.join("\n")}\nRebrand it, or add an exception with a reason in scripts/lib/forkBrand.ts.`;
  }
}

export class BrandLeakDirectoryMissingError extends Schema.TaggedError<BrandLeakDirectoryMissingError>()(
  "BrandLeakDirectoryMissingError",
  { directory: Schema.String },
) {
  override get message(): string {
    return `${this.directory} does not exist; build it before checking it for brand leaks.`;
  }
}

/** Characters a bundler may escape or that end a literal; a context snippet stops at them. */
const SNIPPET_BOUNDARY = /[^\x20-\x7e]|[\\`$"'{}]/;
const SNIPPET_REACH = 40;
const MIN_SNIPPET_CONTEXT = 8;

/**
 * The text around each token in an excepted file's literals, as it appears in
 * an unminified bundle. A snippet without enough context to be specific is
 * dropped, so it cannot excuse unrelated leaks.
 */
const tokenSnippets = (text: string): Array<string> => {
  const snippets: Array<string> = [];
  for (
    let at = text.indexOf(FORK_BRAND_TOKEN);
    at !== -1;
    at = text.indexOf(FORK_BRAND_TOKEN, at + 1)
  ) {
    let start = at;
    while (start > 0 && at - start < SNIPPET_REACH && !SNIPPET_BOUNDARY.test(text[start - 1]!)) {
      start -= 1;
    }
    const tokenEnd = at + FORK_BRAND_TOKEN.length;
    let end = tokenEnd;
    while (
      end < text.length &&
      end - tokenEnd < SNIPPET_REACH &&
      !SNIPPET_BOUNDARY.test(text[end]!)
    ) {
      end += 1;
    }
    if (end - start - FORK_BRAND_TOKEN.length >= MIN_SNIPPET_CONTEXT) {
      snippets.push(text.slice(start, end));
    }
  }
  return snippets;
};

/** Builds the allowlist from the brand layer's exceptions, reading excepted files from the repo. */
export const loadBrandLeakAllowlist = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const phrases: Array<string> = [];
  const propertyPaths: Array<ReadonlyArray<string>> = [];
  for (const exception of FORK_BRAND_EXCEPTIONS) {
    if (exception.kind === "phrase") phrases.push(exception.phrase);
    if (exception.kind === "property") propertyPaths.push(exception.property.split("."));
    if (exception.kind === "file") {
      const file = path.join(repoRoot, exception.file);
      const code = yield* fs.readFileString(file);
      phrases.push(...brandTextSites(code, file).flatMap(tokenSnippets));
    }
  }
  return { phrases, propertyPaths } satisfies BrandLeakAllowlist;
});

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `a: {... b: "` before the token, in source or minified form. */
const propertyPattern = (keys: ReadonlyArray<string>) =>
  new RegExp(
    `${keys
      .map((key) => `(?<![\\w$])["']?${escapeRegExp(key)}["']?\\s*:\\s*`)
      .join("\\{[^{}]*?")}(["'\`])$`,
  );

const lineAndColumn = (text: string, index: number) => {
  const before = text.slice(0, index);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: index - lineStart + 1 };
};

/** Every token in `text` that no allowlist entry covers. */
export const findBrandLeaksInText = (
  text: string,
  allowlist: BrandLeakAllowlist,
): Array<Omit<BrandLeak, "file">> => {
  const patterns = allowlist.propertyPaths.map(propertyPattern);
  const leaks: Array<Omit<BrandLeak, "file">> = [];
  for (
    let at = text.indexOf(FORK_BRAND_TOKEN);
    at !== -1;
    at = text.indexOf(FORK_BRAND_TOKEN, at + 1)
  ) {
    const coveredByPhrase = allowlist.phrases.some((phrase) => {
      for (let offset = phrase.indexOf(FORK_BRAND_TOKEN); offset !== -1;) {
        if (text.startsWith(phrase, at - offset)) return true;
        offset = phrase.indexOf(FORK_BRAND_TOKEN, offset + 1);
      }
      return false;
    });
    const before = text.slice(Math.max(0, at - 240), at);
    const after = text[at + FORK_BRAND_TOKEN.length];
    const coveredByProperty = patterns.some((pattern) => before.match(pattern)?.[1] === after);
    if (coveredByPhrase || coveredByProperty) continue;
    const context = text
      .slice(Math.max(0, at - 60), at + FORK_BRAND_TOKEN.length + 60)
      .replace(/\s+/g, " ");
    leaks.push({ ...lineAndColumn(text, at), context });
  }
  return leaks;
};

/** Every T3 wordmark outline in `text`. Nothing excuses one: the fork draws the Lathe caret. */
export const findWordmarkLeaksInText = (text: string): Array<Omit<BrandLeak, "file">> => {
  const leaks: Array<Omit<BrandLeak, "file">> = [];
  for (
    let at = text.indexOf(T3_WORDMARK_OUTLINE);
    at !== -1;
    at = text.indexOf(T3_WORDMARK_OUTLINE, at + 1)
  ) {
    leaks.push({ ...lineAndColumn(text, at), context: "T3 wordmark outline" });
  }
  return leaks;
};

const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8192).includes(0);

/**
 * Blanks the comments of a JavaScript file, keeping every position. Unminified
 * bundles keep upstream's comments, which the brand layer leaves alone and no
 * user reads. A file that does not parse is scanned whole.
 */
export const withoutComments = (code: string, file: string): string => {
  if (!/\.[cm]?js$/.test(file) || !code.includes(FORK_BRAND_TOKEN)) return code;
  const parsed = parseSync(file, code, { lang: "js" });
  if (parsed.errors.length > 0) return code;
  let output = "";
  let cursor = 0;
  for (const comment of parsed.comments) {
    output +=
      code.slice(cursor, comment.start) +
      code.slice(comment.start, comment.end).replace(/[^\n]/g, " ");
    cursor = comment.end;
  }
  return output + code.slice(cursor);
};

/**
 * Scans every file under `directories` and fails with every leak found.
 * Succeeds with the number of files scanned.
 */
export const checkBrandLeaks = Effect.fn("checkBrandLeaks")(function* (
  directories: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const allowlist = yield* loadBrandLeakAllowlist;
  const decoder = new TextDecoder();
  const leaks: Array<BrandLeak> = [];
  let scanned = 0;
  for (const directory of directories) {
    if (!(yield* fs.exists(directory))) {
      return yield* new BrandLeakDirectoryMissingError({ directory });
    }
    for (const entry of (yield* fs.readDirectory(directory, { recursive: true })).toSorted()) {
      const file = path.join(directory, entry);
      if (file.endsWith(".map") || (yield* fs.stat(file)).type !== "File") continue;
      const bytes = yield* fs.readFile(file);
      if (isBinary(bytes)) continue;
      scanned += 1;
      const text = withoutComments(decoder.decode(bytes), file);
      for (const leak of [
        ...findBrandLeaksInText(text, allowlist),
        ...findWordmarkLeaksInText(text),
      ]) {
        leaks.push({ file, ...leak });
      }
    }
  }
  if (leaks.length > 0) return yield* new BrandLeaksFoundError({ leaks });
  return scanned;
});

const brandLeakCheckCommand = Command.make(
  "brand-leak-check",
  {
    directories: Argument.String("directory").pipe(
      Argument.withDescription("Built output directory to scan."),
      Argument.variadic({ min: 1 }),
    ),
  },
  ({ directories }) =>
    checkBrandLeaks(directories).pipe(
      Effect.flatMap((scanned) =>
        Console.log(
          `No "${FORK_BRAND_TOKEN}" leaks in ${scanned} files under ${directories.join(", ")}.`,
        ),
      ),
    ),
).pipe(Command.withDescription("Check built output for leftover upstream branding."));

if (import.meta.main) {
  Command.run(brandLeakCheckCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
