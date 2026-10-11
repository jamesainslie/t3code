import * as NodeServices from "@effect/platform-node/NodeServices";
import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { rebrandStagedFiles } from "./forkBrandPackaging.ts";

const brand = FORK_IDENTITY.productBaseName;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, ...new TextEncoder().encode("T3 Code")]);

describe("rebrandStagedFiles", () => {
  it.effect("rebrands staged text and scripts, leaving binaries, shell and missing files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-brand-packaging-" });
      const write = (name: string, content: string | Uint8Array) =>
        Effect.gen(function* () {
          const file = path.join(root, name);
          yield* fs.makeDirectory(path.dirname(file), { recursive: true });
          yield* typeof content === "string"
            ? fs.writeFileString(file, content)
            : fs.writeFile(file, content);
          return file;
        });
      yield* write("dmg/background.svg", "<text>Drag T3 Code into Applications.</text>");
      yield* write(
        "package.json",
        `{"name":"t3code","description":"T3 Code CLI.","dependencies":{"t3":"workspace:*"},"scripts":{"b":"vp run --filter t3 build"}}`,
      );
      yield* write("ext/metadata.json", `{"name":"T3 Code SnapShots"}`);
      yield* write(
        "ext/extension.js",
        "// T3 here\nconsole.warn(`T3 capture preview unavailable: ${e}`);\n",
      );
      yield* write("icon.png", png);
      yield* write("run.sh", `echo "T3 Code"; exec t3 serve`);

      yield* rebrandStagedFiles([root, path.join(root, "absent.md")]);

      const read = (name: string) => fs.readFileString(path.join(root, name));
      assert.strictEqual(
        yield* read("dmg/background.svg"),
        `<text>Drag ${brand} into Applications.</text>`,
      );
      assert.strictEqual(
        yield* read("package.json"),
        `{"name":"t3code","description":"${brand} CLI.","dependencies":{"t3":"workspace:*"},"scripts":{"b":"vp run --filter t3 build"}}`,
      );
      assert.strictEqual(yield* read("ext/metadata.json"), `{"name":"${brand} SnapShots"}`);
      assert.strictEqual(
        yield* read("ext/extension.js"),
        `// T3 here\nconsole.warn(\`${brand} capture preview unavailable: \${e}\`);\n`,
      );
      assert.deepStrictEqual(yield* fs.readFile(path.join(root, "icon.png")), png);
      assert.strictEqual(yield* read("run.sh"), `echo "T3 Code"; exec t3 serve`);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
