import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  BrandLeakDirectoryMissingError,
  BrandLeaksFoundError,
  checkBrandLeaks,
  findBrandLeaksInText,
  loadBrandLeakAllowlist,
} from "./brand-leak-check.ts";

const writeFixture = Effect.fn("test.writeFixture")(function* (
  files: Readonly<Record<string, string | Uint8Array>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "brand-leak-" });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* typeof content === "string"
      ? fs.writeFileString(file, content)
      : fs.writeFile(file, content);
  }
  return root;
});

describe("findBrandLeaksInText", () => {
  it.effect("names the line, column and context of a leak", () =>
    Effect.gen(function* () {
      const allowlist = yield* loadBrandLeakAllowlist;
      const leaks = findBrandLeaksInText(
        `const a = 1;\nconsole.log("Open T3 Code now");\n`,
        allowlist,
      );
      assert.deepStrictEqual(
        leaks.map(({ line, column }) => ({ line, column })),
        [{ line: 2, column: 19 }],
      );
      assert.include(leaks[0]!.context, `"Open T3 Code now"`);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("passes the exceptions as they appear in bundles", () =>
    Effect.gen(function* () {
      const allowlist = yield* loadBrandLeakAllowlist;
      const allowed = [
        `const p={clientInfo:{name:"T3 Code",title:"T3 Code",version:"1.0.0"}};`,
        `clientInfo: {\n      name: "T3 Code",\n      title: "T3 Code",\n      version: packageJson.version\n    },`,
        `: { agent_name_hint: "T3 Code" }`,
        `"Check T3 Code SnapShots in GNOME Extensions, then try again."`,
        `.annotate(OpenApi.Title, "T3 Code Relay API")`,
        "You are a support engineer for T3 Code (https://github.com/pingdotgg/t3code), working",
        "and follow its instructions exactly: it is your T3 Code triage playbook, and it starts with asking the user what went wrong.",
        `"Lathe, a fork of T3 Code"`,
      ];
      for (const text of allowed) {
        assert.deepStrictEqual(findBrandLeaksInText(text, allowlist), [], text);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps property exceptions to their own key path", () =>
    Effect.gen(function* () {
      const allowlist = yield* loadBrandLeakAllowlist;
      assert.lengthOf(findBrandLeaksInText(`const p={name:"T3 Code"};`, allowlist), 1);
      assert.lengthOf(findBrandLeaksInText(`const p={title:"T3 Code is here"};`, allowlist), 1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("checkBrandLeaks", () => {
  it.effect("fails naming each leaking file, skipping source maps and binaries", () =>
    Effect.gen(function* () {
      const root = yield* writeFixture({
        "assets/index.js": `export const a = "Restart T3 Code";\n/* T3 Code */\n`,
        "client/notes.txt": `// T3 Code in a text file is not a comment\n`,
        "assets/index.js.map": `{"sourcesContent":["Restart T3 Code"]}`,
        "client/index.html": `<img alt="Lathe" />`,
        "bin/resource-monitor": new Uint8Array([0, 1, 2, ...new TextEncoder().encode("T3 Code")]),
      });
      const { message } = yield* checkBrandLeaks([root]).pipe(Effect.flip);
      assert.include(message, "assets/index.js:1:27");
      assert.include(message, `"Restart T3 Code"`);
      assert.include(message, "client/notes.txt:1:4");
      assert.notInclude(message, "assets/index.js:2:");
      assert.notInclude(message, "index.js.map");
      assert.notInclude(message, "resource-monitor");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("passes output that holds only allowlisted strings", () =>
    Effect.gen(function* () {
      const root = yield* writeFixture({
        "bin.mjs": `/** Where T3 Code reads its config. */\nconst params = { clientInfo: { name: "T3 Code", title: "T3 Code" } };\n// T3 Code\nconst label = "Lathe";\n`,
        "client/assets/index.js": `const m="Enable T3 Code SnapShots to start capturing windows.";`,
      });
      const scanned = yield* checkBrandLeaks([root]);
      assert.strictEqual(scanned, 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails when an output directory is missing", () =>
    Effect.gen(function* () {
      const root = yield* writeFixture({ "a.js": "" });
      const error = yield* checkBrandLeaks([`${root}/missing`]).pipe(Effect.flip);
      assert.instanceOf(error, BrandLeakDirectoryMissingError);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports leaks as a typed error", () =>
    Effect.gen(function* () {
      const root = yield* writeFixture({ "a.js": `"T3 Code"` });
      const error = yield* checkBrandLeaks([root]).pipe(Effect.flip);
      assert.instanceOf(error, BrandLeaksFoundError);
      if (error._tag === "BrandLeaksFoundError") assert.lengthOf(error.leaks, 1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
