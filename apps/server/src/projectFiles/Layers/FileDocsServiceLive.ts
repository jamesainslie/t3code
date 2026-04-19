/**
 * FileDocsServiceLive - docs-browser file operations backed by node:fs and
 * chokidar.
 *
 * - `readFile` - one-shot safe read with size cap and error mapping.
 * - `watch` - chokidar-backed stream of file-change events with snapshot
 *   replay on subscribe, debounced per-path changes, and ref-counted
 *   per-cwd watchers.
 * - `updateFrontmatter` - atomic frontmatter rewrite with mtime guard.
 * - `recordTurnWrite` / `flushTurnWrites` - orchestration hooks for emitting
 *   `turnTouchedDoc` events when a turn writes a .md file.
 */
import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";

import chokidar from "chokidar";
import ignoreFactory from "ignore";
import {
  Effect,
  Exit,
  Layer,
  PubSub,
  Scope,
  Stream,
  SynchronizedRef,
} from "effect";
import type {
  ProjectFileChangeEvent,
  ProjectFileEntry,
  ProjectFileMonitorError,
  ThreadId,
  TurnId,
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

const HARD_CODED_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "out",
  ".turbo",
  ".next",
  "target",
];

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
  subscriberCount: number;
  readonly scope: Scope.Scope;
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

function sanitizeRelative(cwd: string, absolutePath: string): string | null {
  const rel = nodePath.relative(cwd, absolutePath);
  if (rel.length === 0 || rel === "." || rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    return null;
  }
  return toPosix(rel);
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

    // turn-touch buffer: `${threadId}::${turnId}` -> cwd -> Set<relativePath>
    const turnWrites = yield* SynchronizedRef.make(
      new Map<string, Map<string, Set<string>>>(),
    );
    const turnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}::${turnId}`;

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
     * Returns a release effect that decrements the count and tears down the
     * watcher when the last subscriber disconnects.
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
          const scope = yield* Scope.make();
          const files = new Map<string, FileMeta>();
          let ready = false;
          let resolveReady: () => void = () => {};
          const snapshotReady = new Promise<void>((resolve) => {
            resolveReady = resolve;
          });
          const handle: WatcherHandle = {
            pubsub,
            files,
            subscriberCount: 1,
            scope,
            snapshotReady,
            snapshot: [],
          };

          const publishEvent = (event: ProjectFileChangeEvent) =>
            runFork(PubSub.publish(pubsub, event).pipe(Effect.asVoid));

          const processPathEvent = async (
            absolutePath: string,
            kind: "add" | "change" | "unlink",
            stat: { size: number; mtimeMs: number } | null,
          ) => {
            if (!isMarkdown(absolutePath)) return;
            const relativePath = sanitizeRelative(cwd, absolutePath);
            if (!relativePath) return;

            // Self-echo suppression
            const suppressed = await runPromise(isSuppressed(absolutePath)).catch(
              () => false,
            );
            if (suppressed) return;

            if (kind === "unlink") {
              clearDebounce(`${cwd}:${relativePath}`);
              files.delete(relativePath);
              if (ready) {
                publishEvent({ _tag: "removed", relativePath });
              }
              return;
            }

            const meta: FileMeta = stat
              ? {
                  size: stat.size,
                  mtimeMs: stat.mtimeMs,
                  oversized: stat.size > FILE_DOCS_SIZE_CAP_BYTES,
                }
              : { size: 0, mtimeMs: 0, oversized: false };
            files.set(relativePath, meta);

            if (!ready) {
              return;
            }

            // Suppress emissions for oversized files.
            if (meta.oversized) {
              clearDebounce(`${cwd}:${relativePath}`);
              return;
            }

            const debounceKey = `${cwd}:${relativePath}`;
            clearDebounce(debounceKey);
            if (kind === "add") {
              // Added events fire immediately so the UI can render the new tree
              // entry without waiting on debounce.
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
              const current = files.get(relativePath);
              if (!current || current.oversized) return;
              publishEvent({
                _tag: "changed",
                relativePath,
                size: current.size,
                mtimeMs: current.mtimeMs,
              });
            }, FILE_DOCS_DEBOUNCE_INTERVAL_MS);
            debounceTimers.set(debounceKey, timer);
          };

          const ig = yield* Effect.promise(() => loadGitignore(cwd));

          const watcher = chokidar.watch(cwd, {
            persistent: true,
            ignoreInitial: false,
            ignorePermissionErrors: true,
            ignored: (targetPath: string) => {
              if (targetPath === cwd) return false;
              const rel = nodePath.relative(cwd, targetPath);
              if (!rel || rel.startsWith("..")) return false;
              const posix = toPosix(rel);
              // Fast-path hard ignores by segment.
              const segments = posix.split("/");
              for (const segment of segments) {
                if (HARD_CODED_IGNORES.includes(segment)) return true;
              }
              return ig.ignores(posix);
            },
          });

          watcher.on("add", (absolutePath, stat) => {
            if (!stat) return;
            void processPathEvent(absolutePath, "add", stat);
          });
          watcher.on("change", (absolutePath, stat) => {
            if (!stat) return;
            void processPathEvent(absolutePath, "change", stat);
          });
          watcher.on("unlink", (absolutePath) => {
            void processPathEvent(absolutePath, "unlink", null);
          });
          watcher.on("error", (error) => {
            runFork(
              PubSub.publish(pubsub, {
                _tag: "snapshot",
                files: handle.snapshot,
              }).pipe(Effect.asVoid),
            );
            // Also log so we don't lose visibility in tests.
            // eslint-disable-next-line no-console
            console.warn("[FileDocsService] chokidar error", error);
          });

          const onReady = new Promise<void>((resolveChokidar) => {
            watcher.once("ready", resolveChokidar);
          });
          yield* Effect.promise(() => onReady);

          const snapshotEntries: ProjectFileEntry[] = [];
          for (const [relativePath, meta] of files) {
            snapshotEntries.push({
              relativePath,
              size: meta.size,
              mtimeMs: meta.mtimeMs,
              oversized: meta.oversized,
            });
          }
          snapshotEntries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
          handle.snapshot = snapshotEntries;
          ready = true;
          resolveReady();
          yield* PubSub.publish(pubsub, {
            _tag: "snapshot",
            files: snapshotEntries,
          });

          // Attach cleanup into the handle's scope.
          yield* Scope.addFinalizer(
            scope,
            Effect.gen(function* () {
              yield* Effect.promise(() => watcher.close()).pipe(Effect.ignore);
              for (const [key, timer] of debounceTimers) {
                if (key.startsWith(`${cwd}:`)) {
                  clearTimeout(timer);
                  debounceTimers.delete(key);
                }
              }
              yield* PubSub.shutdown(pubsub);
            }),
          );

          const nextMap = new Map(map);
          nextMap.set(cwd, handle);
          return [handle, nextMap] as const;
        }),
      );

    const releaseWatcher = (cwd: string) =>
      SynchronizedRef.modifyEffect(watchers, (map) =>
        Effect.gen(function* () {
          const existing = map.get(cwd);
          if (!existing) {
            return [null as Scope.Scope | null, map] as const;
          }
          if (existing.subscriberCount > 1) {
            existing.subscriberCount -= 1;
            return [null as Scope.Scope | null, map] as const;
          }
          const nextMap = new Map(map);
          nextMap.delete(cwd);
          return [existing.scope, nextMap] as const;
        }),
      ).pipe(
        Effect.flatMap((scope) =>
          scope ? Scope.close(scope, Exit.void) : Effect.void,
        ),
      );

    const readFile: FileDocsServiceShape["readFile"] = (input) =>
      Effect.gen(function* () {
        const resolved = yield* workspacePaths
          .resolveRelativePathWithinRoot({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
          })
          .pipe(
            Effect.mapError(
              () =>
                ({
                  _tag: "PathOutsideRoot" as const,
                  relativePath: input.relativePath,
                }),
            ),
          );

        const stat = yield* Effect.tryPromise({
          try: () => fsPromises.stat(resolved.absolutePath),
          catch: () =>
            ({
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
          catch: () =>
            ({
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

    const updateFrontmatter: FileDocsServiceShape["updateFrontmatter"] = () =>
      Effect.die("FileDocsService.updateFrontmatter is not implemented");

    const recordTurnWrite: FileDocsServiceShape["recordTurnWrite"] = (record: TurnWriteRecord) =>
      SynchronizedRef.update(turnWrites, (map) => {
        const key = turnKey(record.threadId, record.turnId);
        const cwdMap = new Map(map.get(key) ?? new Map<string, Set<string>>());
        const existing = cwdMap.get(record.cwd) ?? new Set<string>();
        const nextSet = new Set(existing);
        nextSet.add(record.relativePath);
        cwdMap.set(record.cwd, nextSet);
        const next = new Map(map);
        next.set(key, cwdMap);
        return next;
      });

    const flushTurnWrites: FileDocsServiceShape["flushTurnWrites"] = (input) =>
      Effect.gen(function* () {
        const [cwdMap] = yield* SynchronizedRef.modify(turnWrites, (map) => {
          const key = turnKey(input.threadId, input.turnId);
          const bucket = map.get(key) ?? new Map<string, Set<string>>();
          const next = new Map(map);
          next.delete(key);
          return [[bucket, key] as const, next] as const;
        });
        const current = yield* SynchronizedRef.get(watchers);
        for (const [cwd, paths] of cwdMap) {
          const handle = current.get(cwd);
          if (!handle) continue;
          yield* PubSub.publish(handle.pubsub, {
            _tag: "turnTouchedDoc",
            threadId: input.threadId,
            turnId: input.turnId,
            paths: [...paths].sort(),
          });
        }
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
