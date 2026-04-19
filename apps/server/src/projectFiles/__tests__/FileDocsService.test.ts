import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import { FileDocsService } from "../Services/FileDocsService.ts";
import { FileDocsServiceLive } from "../Layers/FileDocsServiceLive.ts";

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
});
