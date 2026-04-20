/**
 * FileDocsServiceLive - docs-browser file operations backed by node:fs.
 *
 * - `readFile` - one-shot safe read with size cap and error mapping.
 * - `watch` - markdown snapshot stream with lightweight polling, snapshot
 *   replay on subscribe, debounced per-path changes, and ref-counted
 *   per-cwd pollers.
 * - `updateFrontmatter` - atomic frontmatter rewrite with mtime guard.
 * - `recordTurnWrite` / `flushTurnWrites` - orchestration hooks for emitting
 *   `turnTouchedDoc` events when a turn writes a .md file.
 */
import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import ignoreFactory from "ignore";
import * as YAML from "yaml";
import { Effect, Layer, PubSub, Stream, SynchronizedRef } from "effect";
import type {
  ProjectFileChangeEvent,
  ProjectFileEntry,
  ProjectFileMonitorError,
} from "@t3tools/contracts";

import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";
import {
  FILE_DOCS_DEBOUNCE_INTERVAL_MS,
  FILE_DOCS_SELF_ECHO_WINDOW_MS,
  FILE_DOCS_SIZE_CAP_BYTES,
  FileDocsService,
  type FileDocsServiceShape,
  type TurnWriteRecord,
} from "../Services/FileDocsService.ts";

const HARD_CODED_IGNORES = ["node_modules", ".git", "dist", "out", ".turbo", ".next", "target"];
const FILE_DOCS_POLL_INTERVAL_MS = 750;
const execFileAsync = promisify(execFile);

function noop(): void {
  /* no-op placeholder until the snapshot-ready promise resolver is assigned. */
}

const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

function isMarkdown(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function toPosix(input: string): string {
  return input.replaceAll("\\", "/");
}

interface FileMeta {
  readonly size: number;
  readonly mtimeMs: number;
  readonly oversized: boolean;
}

interface WatcherHandle {
  readonly pubsub: PubSub.PubSub<ProjectFileChangeEvent>;
  readonly files: Map<string, FileMeta>;
  pollTimer?: NodeJS.Timeout;
  subscriberCount: number;
  readonly snapshotReady: Promise<void>;
  snapshot: ReadonlyArray<ProjectFileEntry>;
}

type CwdWatcherMap = Map<string, WatcherHandle>;

function loadGitignore(cwd: string): Promise<ReturnType<typeof ignoreFactory>> {
  const ig = ignoreFactory();
  // Always ignore the hard-coded set.
  ig.add(HARD_CODED_IGNORES);
  return fsPromises
    .readFile(nodePath.join(cwd, ".gitignore"), "utf8")
    .then((text) => {
      ig.add(text);
      return ig;
    })
    .catch(() => ig);
}

function shouldIgnoreRelativePath(
  ig: ReturnType<typeof ignoreFactory>,
  relativePath: string,
): boolean {
  const posix = toPosix(relativePath);
  if (!posix || posix.startsWith("../")) return false;
  const segments = posix.split("/");
  for (const segment of segments) {
    if (HARD_CODED_IGNORES.includes(segment)) return true;
  }
  return ig.ignores(posix);
}

function toSnapshotEntries(files: ReadonlyMap<string, FileMeta>): ProjectFileEntry[] {
  return Array.from(files, ([relativePath, meta]) => ({
    relativePath,
    size: meta.size,
    mtimeMs: meta.mtimeMs,
    oversized: meta.oversized,
  })).toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function listMarkdownFilesWithRg(
  cwd: string,
  ig: ReturnType<typeof ignoreFactory>,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "rg",
    [
      "--files",
      "--hidden",
      "--color",
      "never",
      "--glob",
      "*.md",
      "--glob",
      "*.markdown",
      ...HARD_CODED_IGNORES.flatMap((segment) => ["--glob", `!${segment}/**`]),
    ],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (relativePath) => relativePath.length > 0 && !shouldIgnoreRelativePath(ig, relativePath),
    )
    .map(toPosix);
}

async function listMarkdownFilesWithReaddir(
  cwd: string,
  ig: ReturnType<typeof ignoreFactory>,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = nodePath.join(cwd, relativeDir);
    const entries = await fsPromises.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const relativePath = toPosix(nodePath.join(relativeDir, entry.name));
      if (shouldIgnoreRelativePath(ig, relativePath)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(relativePath);
      } else if (entry.isFile() && isMarkdown(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  await walk("");
  return files.toSorted((a, b) => a.localeCompare(b));
}

async function collectMarkdownSnapshot(
  cwd: string,
  ig: ReturnType<typeof ignoreFactory>,
): Promise<Map<string, FileMeta>> {
  const relativePaths = await listMarkdownFilesWithRg(cwd, ig).catch(() =>
    listMarkdownFilesWithReaddir(cwd, ig),
  );
  const files = new Map<string, FileMeta>();

  for (const relativePath of relativePaths) {
    const absolutePath = nodePath.join(cwd, relativePath);
    const stat = await fsPromises.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) {
      continue;
    }
    files.set(relativePath, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      oversized: stat.size > FILE_DOCS_SIZE_CAP_BYTES,
    });
  }

  return files;
}

/**
 * Rewrite a markdown document's YAML frontmatter, replacing only the `comments`
 * key and preserving every other key verbatim. Body bytes are preserved
 * byte-for-byte. Returns a `FrontmatterInvalid` failure if the document has no
 * `---\n...\n---\n` block.
 */
function rewriteFrontmatter(params: {
  readonly original: string;
  readonly frontmatter: Record<string, unknown>;
  readonly relativePath: string;
}): Effect.Effect<string, { readonly _tag: "FrontmatterInvalid"; readonly relativePath: string }> {
  return Effect.gen(function* () {
    const { original, frontmatter, relativePath } = params;

    if (!original.startsWith("---\n") && !original.startsWith("---\r\n")) {
      return yield* Effect.fail({
        _tag: "FrontmatterInvalid" as const,
        relativePath,
      });
    }

    const newlineWidth = original.startsWith("---\r\n") ? 5 : 4;
    const afterOpen = original.slice(newlineWidth);
    const closeIndex = afterOpen.search(/\r?\n---\r?\n/);
    if (closeIndex === -1) {
      return yield* Effect.fail({
        _tag: "FrontmatterInvalid" as const,
        relativePath,
      });
    }

    const yamlBody = afterOpen.slice(0, closeIndex);
    // Preserve the exact close-delimiter bytes so CRLF/LF line endings survive.
    const closeMatch = afterOpen.slice(closeIndex).match(/^(\r?\n---\r?\n)/);
    const closeDelim = closeMatch?.[1] ?? "\n---\n";
    const body = afterOpen.slice(closeIndex + closeDelim.length);

    const doc = yield* Effect.try({
      try: () => YAML.parse(yamlBody) as unknown,
      catch: () => ({
        _tag: "FrontmatterInvalid" as const,
        relativePath,
      }),
    });
    let parsed: Record<string, unknown>;
    if (doc === null || doc === undefined) {
      parsed = {};
    } else if (typeof doc !== "object" || Array.isArray(doc)) {
      return yield* Effect.fail({
        _tag: "FrontmatterInvalid" as const,
        relativePath,
      });
    } else {
      parsed = { ...(doc as Record<string, unknown>) };
    }

    // Replace only the `comments` key from input; preserve every other key.
    if (Object.prototype.hasOwnProperty.call(frontmatter, "comments")) {
      parsed.comments = frontmatter.comments;
    } else {
      delete parsed.comments;
    }

    const stringified = YAML.stringify(parsed).replace(/\s+$/, "");
    const openDelim = original.startsWith("---\r\n") ? "---\r\n" : "---\n";
    const nextFrontmatter = `${openDelim}${stringified}${closeDelim}`;
    return nextFrontmatter + body;
  });
}

export const FileDocsServiceLive = Layer.effect(
  FileDocsService,
  Effect.gen(function* () {
    const workspacePaths = yield* WorkspacePaths;
    const runtimeContext = yield* Effect.context<never>();
    const runFork = Effect.runForkWith(runtimeContext);
    const runPromise = Effect.runPromiseWith(runtimeContext);

    const watchers = yield* SynchronizedRef.make<CwdWatcherMap>(new Map());

    // self-echo suppression: path -> expiry-ms
    const selfEchoSuppressions = yield* SynchronizedRef.make(new Map<string, number>());
    const markSelfEcho = (absolutePath: string) =>
      SynchronizedRef.update(selfEchoSuppressions, (map) => {
        const next = new Map(map);
        next.set(absolutePath, Date.now() + FILE_DOCS_SELF_ECHO_WINDOW_MS);
        return next;
      });
    const isSuppressed = (absolutePath: string) =>
      Effect.gen(function* () {
        const map = yield* SynchronizedRef.get(selfEchoSuppressions);
        const expiry = map.get(absolutePath);
        if (expiry === undefined) return false;
        if (expiry < Date.now()) {
          yield* SynchronizedRef.update(selfEchoSuppressions, (m) => {
            const next = new Map(m);
            next.delete(absolutePath);
            return next;
          });
          return false;
        }
        return true;
      });

    // turn-touch buffer: cwd -> Set<relativePath>
    const turnWrites = yield* SynchronizedRef.make(new Map<string, Set<string>>());

    // Per-path debounce timer handles per watcher. We track timers in a JS-side map
    // keyed by watcher + path. Each debounce cycle captures the most recent event
    // and emits it after FILE_DOCS_DEBOUNCE_INTERVAL_MS of quiet.
    const debounceTimers = new Map<string, NodeJS.Timeout>();
    function clearDebounce(key: string) {
      const existing = debounceTimers.get(key);
      if (existing) {
        clearTimeout(existing);
        debounceTimers.delete(key);
      }
    }

    /**
     * Build or retrieve the watcher for a given cwd, bumping its reference count.
     * Returns a release effect that decrements the count and stops idle polling.
     * This intentionally avoids chokidar/FSEvents for docs: on macOS, closing
     * large FSEvents trees can block the Electron-hosted server event loop.
     */
    const acquireWatcher = (cwd: string) =>
      SynchronizedRef.modifyEffect(watchers, (map) =>
        Effect.gen(function* () {
          const existing = map.get(cwd);
          if (existing) {
            existing.subscriberCount += 1;
            return [existing, map] as const;
          }
          const pubsub = yield* PubSub.unbounded<ProjectFileChangeEvent>();
          const files = new Map<string, FileMeta>();
          let ready = false;
          let resolveReady: () => void = noop;
          const snapshotReady = new Promise<void>((resolve) => {
            resolveReady = resolve;
          });
          const handle: WatcherHandle = {
            pubsub,
            files,
            subscriberCount: 1,
            snapshotReady,
            snapshot: [],
          };

          const publishEvent = (event: ProjectFileChangeEvent) =>
            runFork(PubSub.publish(pubsub, event).pipe(Effect.asVoid));

          const processFileDiff = async (
            relativePath: string,
            kind: "add" | "change" | "unlink",
            meta: FileMeta | null,
          ) => {
            const absolutePath = nodePath.join(cwd, relativePath);

            // Self-echo suppression
            const suppressed = await runPromise(isSuppressed(absolutePath)).catch(() => false);

            if (kind === "unlink") {
              clearDebounce(`${cwd}:${relativePath}`);
              files.delete(relativePath);
              handle.snapshot = toSnapshotEntries(files);
              if (ready && !suppressed) {
                publishEvent({ _tag: "removed", relativePath });
              }
              return;
            }

            const previous = files.get(relativePath);
            if (!meta) return;
            files.set(relativePath, meta);
            handle.snapshot = toSnapshotEntries(files);

            if (!ready || suppressed) {
              return;
            }

            // Sticky oversized flag: once a file has been observed oversized,
            // treat intermediate events as oversized too.
            const isCurrentlyOversized = meta.oversized || previous?.oversized === true;

            const debounceKey = `${cwd}:${relativePath}`;
            clearDebounce(debounceKey);

            if (isCurrentlyOversized) {
              return;
            }

            if (kind === "add") {
              publishEvent({
                _tag: "added",
                relativePath,
                size: meta.size,
                mtimeMs: meta.mtimeMs,
              });
              return;
            }
            // change
            const timer = setTimeout(() => {
              debounceTimers.delete(debounceKey);
              void (async () => {
                try {
                  const freshStat = await fsPromises.stat(absolutePath);
                  const finalMeta: FileMeta = {
                    size: freshStat.size,
                    mtimeMs: freshStat.mtimeMs,
                    oversized: freshStat.size > FILE_DOCS_SIZE_CAP_BYTES,
                  };
                  files.set(relativePath, finalMeta);
                  handle.snapshot = toSnapshotEntries(files);
                  if (finalMeta.oversized) return;
                  publishEvent({
                    _tag: "changed",
                    relativePath,
                    size: finalMeta.size,
                    mtimeMs: finalMeta.mtimeMs,
                  });
                } catch {
                  // File was removed before emission — the next poll will emit
                  // the `removed` event.
                }
              })();
            }, FILE_DOCS_DEBOUNCE_INTERVAL_MS);
            debounceTimers.set(debounceKey, timer);
          };

          const diffAndPublish = async (nextFiles: Map<string, FileMeta>) => {
            const previousFiles = new Map(files);

            for (const relativePath of previousFiles.keys()) {
              if (!nextFiles.has(relativePath)) {
                await processFileDiff(relativePath, "unlink", null);
              }
            }

            for (const [relativePath, nextMeta] of nextFiles) {
              const previousMeta = previousFiles.get(relativePath);
              if (!previousMeta) {
                await processFileDiff(relativePath, "add", nextMeta);
                continue;
              }
              if (
                previousMeta.size !== nextMeta.size ||
                previousMeta.mtimeMs !== nextMeta.mtimeMs ||
                previousMeta.oversized !== nextMeta.oversized
              ) {
                await processFileDiff(relativePath, "change", nextMeta);
              }
            }
          };

          const ig = yield* Effect.promise(() => loadGitignore(cwd));
          const initialFiles = yield* Effect.promise(() => collectMarkdownSnapshot(cwd, ig));
          files.clear();
          for (const [relativePath, meta] of initialFiles) {
            files.set(relativePath, meta);
          }

          const snapshotEntries = toSnapshotEntries(files);
          handle.snapshot = snapshotEntries;
          ready = true;
          resolveReady();
          yield* PubSub.publish(pubsub, {
            _tag: "snapshot",
            files: snapshotEntries,
          });

          let pollInFlight = false;
          const pollTimer = setInterval(() => {
            if (!ready || pollInFlight || handle.subscriberCount === 0) {
              return;
            }
            pollInFlight = true;
            void collectMarkdownSnapshot(cwd, ig)
              .then(diffAndPublish)
              .catch((error: unknown) => {
                runFork(
                  Effect.logWarning("FileDocsService poll error", {
                    cwd,
                    detail: error instanceof Error ? error.message : String(error),
                  }),
                );
              })
              .finally(() => {
                pollInFlight = false;
              });
          }, FILE_DOCS_POLL_INTERVAL_MS);
          handle.pollTimer = pollTimer;

          const nextMap = new Map(map);
          nextMap.set(cwd, handle);
          return [handle, nextMap] as const;
        }),
      );

    const releaseWatcher = (cwd: string) =>
      SynchronizedRef.update(watchers, (map) => {
        const existing = map.get(cwd);
        if (!existing) {
          return map;
        }
        if (existing.subscriberCount > 1) {
          existing.subscriberCount -= 1;
          return map;
        }
        if (existing.pollTimer) {
          clearInterval(existing.pollTimer);
        }
        for (const relativePath of existing.files.keys()) {
          clearDebounce(`${cwd}:${relativePath}`);
        }
        const next = new Map(map);
        next.delete(cwd);
        return next;
      });

    const readFile: FileDocsServiceShape["readFile"] = (input) =>
      Effect.gen(function* () {
        const resolved = yield* workspacePaths
          .resolveRelativePathWithinRoot({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
          })
          .pipe(
            Effect.mapError(() => ({
              _tag: "PathOutsideRoot" as const,
              relativePath: input.relativePath,
            })),
          );

        const stat = yield* Effect.tryPromise({
          try: () => fsPromises.stat(resolved.absolutePath),
          catch: () => ({
            _tag: "NotFound" as const,
            relativePath: resolved.relativePath,
          }),
        });

        if (stat.size > FILE_DOCS_SIZE_CAP_BYTES) {
          return yield* Effect.fail({
            _tag: "TooLarge" as const,
            relativePath: resolved.relativePath,
          });
        }

        const contents = yield* Effect.tryPromise({
          try: () => fsPromises.readFile(resolved.absolutePath, "utf8"),
          catch: () => ({
            _tag: "NotReadable" as const,
            relativePath: resolved.relativePath,
          }),
        });

        return {
          contents,
          relativePath: resolved.relativePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      });

    const watch: FileDocsServiceShape["watch"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const handle = yield* acquireWatcher(input.cwd).pipe(
            Effect.mapError(
              (): ProjectFileMonitorError => ({
                _tag: "MonitorFailed",
                detail: "Failed to initialize watcher.",
              }),
            ),
          );

          const subscription = yield* PubSub.subscribe(handle.pubsub);
          const release = releaseWatcher(input.cwd).pipe(Effect.ignore);

          const initialSnapshot: ProjectFileChangeEvent = {
            _tag: "snapshot",
            files: handle.snapshot,
          };

          return Stream.concat(
            Stream.make(initialSnapshot),
            Stream.fromSubscription(subscription).pipe(
              // Drop the initial snapshot already replayed above so we don't
              // double-emit the event.
              Stream.filter((event) => event._tag !== "snapshot"),
            ),
          ).pipe(Stream.ensuring(release));
        }),
      );

    const updateFrontmatter: FileDocsServiceShape["updateFrontmatter"] = (input) =>
      Effect.gen(function* () {
        const resolved = yield* workspacePaths
          .resolveRelativePathWithinRoot({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
          })
          .pipe(
            Effect.mapError(() => ({
              _tag: "PathOutsideRoot" as const,
              relativePath: input.relativePath,
            })),
          );

        // Prime the self-echo suppression *before* the write so concurrently
        // delivered poll diffs for this path are dropped.
        yield* markSelfEcho(resolved.absolutePath);

        const existing = yield* Effect.tryPromise({
          try: () => fsPromises.readFile(resolved.absolutePath, "utf8"),
          catch: () => ({
            _tag: "NotFound" as const,
            relativePath: resolved.relativePath,
          }),
        });

        const expectedMtimeMs = input.expectedMtimeMs;
        if (expectedMtimeMs !== undefined) {
          const stat = yield* Effect.tryPromise({
            try: () => fsPromises.stat(resolved.absolutePath),
            catch: () => ({
              _tag: "NotFound" as const,
              relativePath: resolved.relativePath,
            }),
          });
          if (Math.floor(stat.mtimeMs) !== Math.floor(expectedMtimeMs)) {
            return yield* Effect.fail({
              _tag: "ConcurrentModification" as const,
              relativePath: resolved.relativePath,
            });
          }
        }

        const rewritten = yield* rewriteFrontmatter({
          original: existing,
          frontmatter: input.frontmatter,
          relativePath: resolved.relativePath,
        });

        const tempPath = `${resolved.absolutePath}.tmp`;
        yield* Effect.tryPromise({
          try: async () => {
            await fsPromises.writeFile(tempPath, rewritten, "utf8");
            await fsPromises.rename(tempPath, resolved.absolutePath);
          },
          catch: () => ({
            _tag: "NotFound" as const,
            relativePath: resolved.relativePath,
          }),
        });

        // Re-mark self-echo after write to extend the suppression window over
        // post-rename poll delivery.
        yield* markSelfEcho(resolved.absolutePath);

        const afterStat = yield* Effect.tryPromise({
          try: () => fsPromises.stat(resolved.absolutePath),
          catch: () => ({
            _tag: "NotFound" as const,
            relativePath: resolved.relativePath,
          }),
        });

        yield* SynchronizedRef.update(watchers, (map) => {
          const handle = map.get(input.cwd);
          if (!handle) return map;
          handle.files.set(resolved.relativePath, {
            size: afterStat.size,
            mtimeMs: afterStat.mtimeMs,
            oversized: afterStat.size > FILE_DOCS_SIZE_CAP_BYTES,
          });
          handle.snapshot = toSnapshotEntries(handle.files);
          return map;
        });

        return { mtimeMs: afterStat.mtimeMs };
      });

    const recordTurnWrite: FileDocsServiceShape["recordTurnWrite"] = (record: TurnWriteRecord) =>
      SynchronizedRef.update(turnWrites, (map) => {
        if (!isMarkdown(record.relativePath)) return map;
        const existing = map.get(record.cwd) ?? new Set<string>();
        const nextSet = new Set(existing);
        nextSet.add(record.relativePath);
        const next = new Map(map);
        next.set(record.cwd, nextSet);
        return next;
      });

    const flushTurnWrites: FileDocsServiceShape["flushTurnWrites"] = (input) =>
      Effect.gen(function* () {
        const bucket = yield* SynchronizedRef.modify(turnWrites, (map) => {
          const existing = map.get(input.cwd) ?? new Set<string>();
          const next = new Map(map);
          next.delete(input.cwd);
          return [existing, next] as const;
        });
        if (bucket.size === 0) return;

        const current = yield* SynchronizedRef.get(watchers);
        const handle = current.get(input.cwd);
        if (!handle) return;

        yield* PubSub.publish(handle.pubsub, {
          _tag: "turnTouchedDoc",
          threadId: input.threadId,
          turnId: input.turnId,
          paths: [...bucket].toSorted(),
        });
      });

    // markSelfEcho is intentionally kept as a closure captured by
    // updateFrontmatter; it is not part of the public shape.
    void markSelfEcho;

    return {
      readFile,
      watch,
      updateFrontmatter,
      recordTurnWrite,
      flushTurnWrites,
    } satisfies FileDocsServiceShape;
  }),
);
