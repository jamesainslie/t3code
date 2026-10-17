import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { projectFilePath, readProjectFileWithLegacyFallback } from "./forkLegacyProjectFile.ts";
import * as LatheProjectFileLoader from "./LatheProjectFileLoader.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(LatheProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const workspaceWith = Effect.fn("workspaceWith")(function* (
  files: Readonly<Record<string, string>>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "lathe-legacy-project-file-" });
  for (const [name, contents] of Object.entries(files)) {
    yield* fileSystem.writeFileString(path.join(cwd, name), contents).pipe(Effect.orDie);
  }
  return cwd;
});

it.layer(layerTest)("project files from before the Lathe rename", (it) => {
  describe("projectFilePath", () => {
    it.effect(
      "prefers lathe.json, falls back to t3.json, and names lathe.json when neither exists",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const at = (cwd: string) => projectFilePath(fileSystem, path, cwd);
          const both = yield* workspaceWith({ "lathe.json": "{}", "t3.json": "{}" });
          const legacy = yield* workspaceWith({ "t3.json": "{}" });
          const neither = yield* workspaceWith({});
          expect(yield* at(both)).toBe(path.join(both, "lathe.json"));
          expect(yield* at(legacy)).toBe(path.join(legacy, "t3.json"));
          expect(yield* at(neither)).toBe(path.join(neither, "lathe.json"));
        }),
    );
  });

  it.effect("loads a project that only has t3.json", () =>
    Effect.gen(function* () {
      const loader = yield* LatheProjectFileLoader.LatheProjectFileLoader;
      const cwd = yield* workspaceWith({
        "t3.json": JSON.stringify({ scripts: [{ name: "Dev", command: "pnpm dev" }] }),
      });
      const loaded = yield* loader.load(cwd);
      expect(Option.getOrNull(loaded)?.scripts?.[0]?.name).toBe("Dev");
    }),
  );

  it.effect("serves t3.json to a client reading lathe.json", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* workspaceWith({ "t3.json": "{}" });
      const read = (input: { readonly cwd: string; readonly relativePath: string }) =>
        fileSystem.readFileString(path.join(input.cwd, input.relativePath)).pipe(
          Effect.map((contents) => ({
            relativePath: input.relativePath,
            contents,
            byteLength: contents.length,
            truncated: false,
          })),
        );
      const result = yield* readProjectFileWithLegacyFallback(
        { cwd, relativePath: "lathe.json" },
        read,
      );
      expect(result).toEqual({
        relativePath: "lathe.json",
        contents: "{}",
        byteLength: 2,
        truncated: false,
      });
    }),
  );
});
