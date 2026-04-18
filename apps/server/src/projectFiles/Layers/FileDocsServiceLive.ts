/**
 * FileDocsServiceLive - placeholder implementation.
 *
 * Real implementations are added in subsequent commits (TDD). Each method
 * currently dies until its test drives the minimal implementation.
 */
import { Effect, Layer, Stream } from "effect";

import {
  FileDocsService,
  type FileDocsServiceShape,
} from "../Services/FileDocsService.ts";

export const FileDocsServiceLive = Layer.effect(
  FileDocsService,
  Effect.gen(function* () {
    const readFile: FileDocsServiceShape["readFile"] = () =>
      Effect.die("FileDocsService.readFile is not implemented");

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
