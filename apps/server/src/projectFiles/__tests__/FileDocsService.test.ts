import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Chunk, Deferred, Effect, FileSystem, Layer, Path, Stream } from "effect";

import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import { FileDocsService } from "../Services/FileDocsService.ts";
import { FileDocsServiceLive } from "../Layers/FileDocsServiceLive.ts";
import type { ProjectFileChangeEvent } from "@t3tools/contracts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(FileDocsServiceLive),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.fn("makeTempDir")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-file-docs-",
  });
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
  return absolutePath;
});

it.layer(TestLayer)("FileDocsService", (it) => {
  describe("readFile", () => {
    it.effect("returns contents, size, mtimeMs for a valid .md file", () =>
      Effect.gen(function* () {
        const service = yield* FileDocsService;
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "README.md", "# hi\n");

        const result = yield* service.readFile({ cwd, relativePath: "README.md" });

        expect(result.contents).toBe("# hi\n");
        expect(result.relativePath).toBe("README.md");
        expect(result.size).toBe(5);
        expect(result.mtimeMs).toBeGreaterThan(0);
      }),
    );

    it.effect("returns NotFound when the file does not exist", () =>
      Effect.gen(function* () {
        const service = yield* FileDocsService;
        const cwd = yield* makeTempDir();

        const error = yield* service
          .readFile({ cwd, relativePath: "missing.md" })
          .pipe(Effect.flip);

        expect(error._tag).toBe("NotFound");
        expect(error.relativePath).toBe("missing.md");
      }),
    );

    it.effect("returns TooLarge for files larger than SIZE_CAP", () =>
      Effect.gen(function* () {
        const service = yield* FileDocsService;
        const cwd = yield* makeTempDir();
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const absolutePath = path.join(cwd, "big.md");
        // Write a 6 MB file
        const chunk = "x".repeat(1024);
        const buffer = chunk.repeat(6 * 1024); // 6 MB
        yield* fileSystem.writeFileString(absolutePath, buffer).pipe(Effect.orDie);

        const error = yield* service.readFile({ cwd, relativePath: "big.md" }).pipe(Effect.flip);

        expect(error._tag).toBe("TooLarge");
        expect(error.relativePath).toBe("big.md");
      }),
    );

    it.effect("returns PathOutsideRoot for escaping paths", () =>
      Effect.gen(function* () {
        const service = yield* FileDocsService;
        const cwd = yield* makeTempDir();

        const error = yield* service
          .readFile({ cwd, relativePath: "../escape.md" })
          .pipe(Effect.flip);

        expect(error._tag).toBe("PathOutsideRoot");
        expect(error.relativePath).toBe("../escape.md");
      }),
    );

    it.effect("returns NotReadable for files with denied read access", () =>
      Effect.gen(function* () {
        const service = yield* FileDocsService;
        const cwd = yield* makeTempDir();
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;
        const absolutePath = path.join(cwd, "no-access.md");
        yield* fileSystem.writeFileString(absolutePath, "# forbidden").pipe(Effect.orDie);
        // Strip all permissions
        yield* Effect.promise(async () => {
          const fs = await import("node:fs/promises");
          await fs.chmod(absolutePath, 0o000);
        });

        const error = yield* service
          .readFile({ cwd, relativePath: "no-access.md" })
          .pipe(Effect.flip);

        // Restore so tempdir cleanup succeeds
        yield* Effect.promise(async () => {
          const fs = await import("node:fs/promises");
          await fs.chmod(absolutePath, 0o644);
        });

        expect(error._tag).toBe("NotReadable");
        expect(error.relativePath).toBe("no-access.md");
      }),
    );
  });

  describe("watch", () => {
    it.effect(
      "emits a snapshot event with all matching .md files",
      () =>
        Effect.gen(function* () {
          const service = yield* FileDocsService;
          const cwd = yield* makeTempDir();
          yield* writeTextFile(cwd, "a.md", "# a\n");
          yield* writeTextFile(cwd, "docs/b.md", "# b\n");
          yield* writeTextFile(cwd, "ignore.txt", "text");

          const snapshotDeferred = yield* Deferred.make<ProjectFileChangeEvent>();

          yield* service
            .watch({ cwd, globs: ["**/*.md"], ignoreGlobs: [] })
            .pipe(
              Stream.runForEach((event) =>
                event._tag === "snapshot"
                  ? Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore)
                  : Effect.void,
              ),
              Effect.forkScoped,
            );

          const snapshot = yield* Deferred.await(snapshotDeferred);

          if (snapshot._tag !== "snapshot") {
            throw new Error("expected snapshot event");
          }
          const files = snapshot.files.map((f) => f.relativePath).toSorted();
          expect(files).toEqual(["a.md", "docs/b.md"]);
          for (const file of snapshot.files) {
            expect(file.oversized).toBe(false);
            expect(file.size).toBeGreaterThan(0);
            expect(file.mtimeMs).toBeGreaterThan(0);
          }
        }),
      { timeout: 10_000 },
    );

    it.effect(
      "debounces rapid writes into a single changed event per path",
      () =>
        Effect.gen(function* () {
          const service = yield* FileDocsService;
          const cwd = yield* makeTempDir();
          yield* writeTextFile(cwd, "a.md", "# original\n");

          const snapshotDeferred = yield* Deferred.make<ProjectFileChangeEvent>();
          const changedCount = { value: 0 };

          yield* service
            .watch({ cwd, globs: ["**/*.md"], ignoreGlobs: [] })
            .pipe(
              Stream.runForEach((event) => {
                if (event._tag === "snapshot") {
                  return Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore);
                }
                if (event._tag === "changed") {
                  changedCount.value += 1;
                }
                return Effect.void;
              }),
              Effect.forkScoped,
            );

          yield* Deferred.await(snapshotDeferred);

          // Issue 5 writes within 50ms — all should coalesce into one event.
          yield* Effect.promise(async () => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            for (let i = 0; i < 5; i++) {
              await fs.writeFile(path.join(cwd, "a.md"), `# v${i}\n`);
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          });

          // Wait 400ms — longer than debounce window (150ms) and chokidar
          // settle delay — to be sure the coalesced event has fired.
          yield* Effect.promise(
            () => new Promise((resolve) => setTimeout(resolve, 400)),
          );

          expect(changedCount.value).toBe(1);
        }),
      { timeout: 10_000 },
    );

    it.effect(
      "emits added/changed/removed events for subsequent file-system mutations",
      () =>
        Effect.gen(function* () {
          const service = yield* FileDocsService;
          const cwd = yield* makeTempDir();
          yield* writeTextFile(cwd, "seed.md", "# seed\n");

          const snapshotDeferred = yield* Deferred.make<ProjectFileChangeEvent>();
          const addedDeferred = yield* Deferred.make<ProjectFileChangeEvent>();
          const changedDeferred = yield* Deferred.make<ProjectFileChangeEvent>();
          const removedDeferred = yield* Deferred.make<ProjectFileChangeEvent>();

          yield* service
            .watch({ cwd, globs: ["**/*.md"], ignoreGlobs: [] })
            .pipe(
              Stream.runForEach((event) => {
                switch (event._tag) {
                  case "snapshot":
                    return Deferred.succeed(snapshotDeferred, event).pipe(Effect.ignore);
                  case "added":
                    return Deferred.succeed(addedDeferred, event).pipe(Effect.ignore);
                  case "changed":
                    return Deferred.succeed(changedDeferred, event).pipe(Effect.ignore);
                  case "removed":
                    return Deferred.succeed(removedDeferred, event).pipe(Effect.ignore);
                  default:
                    return Effect.void;
                }
              }),
              Effect.forkScoped,
            );

          // Wait until the watcher is ready (first event is always snapshot).
          yield* Deferred.await(snapshotDeferred);

          yield* writeTextFile(cwd, "new.md", "# new\n");
          const added = yield* Deferred.await(addedDeferred);
          expect(added._tag).toBe("added");
          if (added._tag === "added") {
            expect(added.relativePath).toBe("new.md");
          }

          // Wait past the debounce window (150ms) for the change event to flush.
          yield* writeTextFile(cwd, "seed.md", "# seed updated\n");
          const changed = yield* Deferred.await(changedDeferred);
          expect(changed._tag).toBe("changed");
          if (changed._tag === "changed") {
            expect(changed.relativePath).toBe("seed.md");
          }

          yield* Effect.promise(async () => {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            await fs.unlink(path.join(cwd, "new.md"));
          });
          const removed = yield* Deferred.await(removedDeferred);
          expect(removed._tag).toBe("removed");
          if (removed._tag === "removed") {
            expect(removed.relativePath).toBe("new.md");
          }
        }),
      { timeout: 10_000 },
    );
  });
});

// Unused Chunk import keeps the helper available for subsequent tests.
void Chunk;
