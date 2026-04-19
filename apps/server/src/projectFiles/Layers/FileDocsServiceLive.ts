/**
 * FileDocsServiceLive - docs-browser file operations backed by node:fs.
 *
 * Subsequent commits layer on the watcher, debounce, self-echo suppression,
 * and atomic frontmatter writer. This file is intentionally growing in small
 * steps to keep each TDD iteration reviewable.
 */
import * as fsPromises from "node:fs/promises";

import { Effect, Layer, Stream } from "effect";

import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";
import {
  FILE_DOCS_SIZE_CAP_BYTES,
  FileDocsService,
  type FileDocsServiceShape,
} from "../Services/FileDocsService.ts";

export const FileDocsServiceLive = Layer.effect(
  FileDocsService,
  Effect.gen(function* () {
    const workspacePaths = yield* WorkspacePaths;

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

    const watch: FileDocsServiceShape["watch"] = () =>
      Stream.die("FileDocsService.watch is not implemented");

    const updateFrontmatter: FileDocsServiceShape["updateFrontmatter"] = () =>
      Effect.die("FileDocsService.updateFrontmatter is not implemented");

    const recordTurnWrite: FileDocsServiceShape["recordTurnWrite"] = () =>
      Effect.die("FileDocsService.recordTurnWrite is not implemented");

    const flushTurnWrites: FileDocsServiceShape["flushTurnWrites"] = () =>
      Effect.die("FileDocsService.flushTurnWrites is not implemented");

    return {
      readFile,
      watch,
      updateFrontmatter,
      recordTurnWrite,
      flushTurnWrites,
    } satisfies FileDocsServiceShape;
  }),
);
