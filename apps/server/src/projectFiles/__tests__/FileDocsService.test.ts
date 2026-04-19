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
  });
});
