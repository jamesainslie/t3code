import { describe, expect, it } from "vite-plus/test";

import { renameForkPath, renameForkText } from "./forkRenameCodemod.ts";

const rename = (path: string, text: string) => renameForkText(path, text).text;

describe("renameForkText", () => {
  it.each<readonly [string, string, string]>([
    [
      "apps/web/src/a.ts",
      'import { X } from "@t3tools/contracts";',
      'import { X } from "@lathe/contracts";',
    ],
    [
      "apps/web/src/a.tsx",
      "export function T3ComposerEditorView() {}",
      "export function LatheComposerEditorView() {}",
    ],
    [
      "apps/web/src/a.ts",
      "const t3Home = resolveT3Home();",
      "const latheHome = resolveLatheHome();",
    ],
    [
      "apps/web/src/a.ts",
      'const message = "Restart T3 Code?";',
      'const message = "Restart Lathe?";',
    ],
    [
      "apps/server/src/cli/config.ts",
      'Config.String("T3CODE_HOME")',
      'Config.String("LATHE_HOME")',
    ],
    ["apps/server/src/x.ts", "const url = env.T3_MCP_URL;", "const url = env.LATHE_MCP_URL;"],
    ["apps/server/src/x.ts", '"mcp__t3-code__t3_thread_list",', '"mcp__lathe__lathe_thread_list",'],
    [
      "packages/shared/src/assistantCitations.ts",
      'const CITATION_PROTOCOL = "t3-citation:";',
      'const CITATION_PROTOCOL = "lathe-citation:";',
    ],
    ["docs/user/install.md", "Run `t3 serve` to start.", "Run `lathe serve` to start."],
    ["docs/user/install.md", "Or run `npx t3` once.", "Or run `npx @jamesainslie/lathe` once."],
    [
      "apps/server/src/cli/update.ts",
      "`Updated to t3@${version}.`",
      "`Updated to @jamesainslie/lathe@${version}.`",
    ],
  ])("renames %s: %s", (path, input, expected) => {
    expect(rename(path, input)).toBe(expected);
  });

  it.each<readonly [string, string]>([
    ["apps/server/src/x.ts", 'headers["x-t3-relay-delivery-id"]'],
    [
      "packages/contracts/src/t3ProjectFile.ts",
      'const schema = "https://t3.codes/schema/t3.json";',
    ],
    ["README.md", "Fork of https://github.com/pingdotgg/t3code"],
    ["packages/shared/src/imageDimensions.ts", "const n = data.getUint32(0);"],
    ["packages/shared/src/forkLegacyEnv.ts", 'const LEGACY_PREFIX = "T3CODE_";'],
  ])("leaves kept, wire, upstream and false-positive names alone: %s", (path, input) => {
    expect(rename(path, input)).toBe(input);
  });

  it("is idempotent", () => {
    const once = rename("apps/web/src/a.ts", 'import { T3Xyz } from "@t3tools/shared"; // T3 Code');
    expect(rename("apps/web/src/a.ts", once)).toBe(once);
  });

  it("refuses text with an unclassified occurrence", () => {
    expect(() => renameForkText("apps/server/src/x.ts", 'const NEW_NAME = "t3wombat";')).toThrow(
      /t3wombat/,
    );
  });
});

describe("renameForkPath", () => {
  it.each<readonly [string, string]>([
    ["apps/mobile/modules/t3-terminal/index.ts", "apps/mobile/modules/lathe-terminal/index.ts"],
    [
      "oxlint-plugin-t3code/rules/no-test-in-loop.ts",
      "oxlint-plugin-lathe/rules/no-test-in-loop.ts",
    ],
    [
      "packages/shared/src/t3McpToolPresentation.ts",
      "packages/shared/src/latheMcpToolPresentation.ts",
    ],
    ["apps/web/src/components/T3Wordmark.tsx", "apps/web/src/components/LatheWordmark.tsx"],
    ["packaging/aur/t3code-bin/PKGBUILD", "packaging/aur/t3code-bin/PKGBUILD"],
  ])("renames %s", (path, expected) => {
    expect(renameForkPath(path)).toBe(expected);
  });
});
