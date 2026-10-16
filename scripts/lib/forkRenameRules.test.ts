import { describe, expect, it } from "vite-plus/test";

import {
  classifyRenameOccurrence,
  findRenameOccurrences,
  FORK_RENAME_RULES,
  type RenameClass,
} from "./forkRenameRules.ts";

/** The class of the first t3 hit on `line` in a file at `path`. */
const classOf = (path: string, line: string): RenameClass | "unclassified" => {
  const [occurrence] = findRenameOccurrences(path, line);
  if (!occurrence) throw new Error(`no t3 in ${line}`);
  return classifyRenameOccurrence(FORK_RENAME_RULES, occurrence)?.class ?? "unclassified";
};

describe("findRenameOccurrences", () => {
  it("finds every hit, including two inside one token", () => {
    const hits = findRenameOccurrences(
      "a.ts",
      'import x from "@t3tools/t3-terminal";\nconst y = 1;',
    );
    expect(hits.map((hit) => [hit.token, hit.offset])).toEqual([
      ["@t3tools/t3-terminal", 1],
      ["@t3tools/t3-terminal", 9],
    ]);
  });
});

describe("FORK_RENAME_RULES", () => {
  it.each<readonly [string, string, RenameClass]>([
    ["packages/shared/src/imageDimensions.ts", "const n = data.getUint32(0);", "false-positive"],
    ["apps/web/src/a.ts", 'import { X } from "@t3tools/contracts";', "identifier"],
    ["apps/web/src/a.tsx", "export function T3ComposerEditorView() {}", "identifier"],
    ["apps/web/src/a.ts", 'const message = "Restart T3 Code?";', "display"],
    ["apps/server/src/cli/config.ts", 'Config.String("T3CODE_HOME")', "persisted"],
    ["scripts/build-desktop-artifact.ts", "process.env.T3CODE_DESKTOP_PLATFORM", "identifier"],
    [
      "packages/shared/src/assistantCitations.ts",
      'const CITATION_PROTOCOL = "t3-citation:";',
      "persisted",
    ],
    ["apps/server/src/x.ts", 'headers["x-t3-relay-delivery-id"]', "wire-peer"],
    ["apps/server/src/x.ts", "const total = allT3.processStarts;", "wire-peer"],
    [
      "packages/contracts/src/t3ProjectFile.ts",
      'export const T3_PROJECT_FILE_NAME = "t3.json";',
      "persisted",
    ],
    [
      "packages/contracts/src/t3ProjectFile.ts",
      'const schema = "https://t3.codes/schema/t3.json";',
      "kept",
    ],
    ["apps/server/src/x.ts", '"mcp__t3-code__t3_thread_list",', "agent-facing"],
    ["packages/shared/src/mcpApp.ts", 'export const MCP_APP_OUTPUT_KEY = "t3McpApp";', "kept"],
    // Tokens never include quotes, so these quoted literals must still match their rules.
    [
      "packages/client-runtime/src/connection/catalog.ts",
      'authorization: Schema.optionalKey(Schema.Literal("t3-connect")),',
      "kept",
    ],
    ["apps/server/src/cli/config.ts", 'Config.String("T3CODE_PORT")', "persisted"],
    ["packages/shared/src/forkLegacyEnv.ts", 'const LEGACY_PREFIX = "T3CODE_";', "kept"],
    [
      "apps/server/src/provider/ProviderCredentialStore.ts",
      'binding: { owner: "t3" as const, key },',
      "wire-peer",
    ],
    ["README.md", "Fork of https://github.com/pingdotgg/t3code", "upstream-reference"],
    // Dotted uses of kept names keep them too.
    ["apps/web/src/a.tsx", "const all = snapshot?.groups.allT3;", "wire-peer"],
    ["apps/server/src/a.ts", "t3CodeVersion: packageJson.version,", "wire-peer"],
    ["packages/provider-cursor/src/server/auth.ts", 'credentialOwner: "t3" as const,', "wire-peer"],
    [
      "packages/provider-core/src/server/auth.ts",
      'readonly owner: "provider" | "t3";',
      "wire-peer",
    ],
    ["apps/server/src/provider/model-manifest.json", '"t3CodeRange": ">=0.0.44",', "kept"],
    ["apps/server/src/provider/x.ts", "satisfies(version, entry.t3CodeRange)", "kept"],
    ["scripts/install.test.ts", 'pack(root, "legacy", { t3: "t3 v1.2.3" })', "kept"],
    // Mobile keeps its own names but follows renamed shared code.
    ["apps/mobile/src/lib/a.ts", 'import { T3_PROJECT_FILE_NAME } from "x";', "identifier"],
    [
      "apps/marketing/src/pages/schema/t3.json.ts",
      'import { buildT3ProjectFileJsonSchema } from "@t3tools/shared/t3ProjectFile";',
      "identifier",
    ],
    ["apps/mobile/src/lib/a.ts", "  resolveT3McpToolPresentation,", "identifier"],
    ["apps/mobile/src/a.tsx", ') : presentation.attribution === "t3code" ? (', "identifier"],
    ["apps/mobile/src/a.tsx", "Sent by T3 Code", "display"],
    ["apps/mobile/src/a.tsx", 'if (props.icon === "t3-code") {', "agent-facing"],
    ["apps/mobile/src/a.tsx", 'import { T3Wordmark } from "../../components/T3Wordmark";', "kept"],
    ["apps/mobile/src/a.tsx", '<Text className="font-t3-medium">', "kept"],
    ["apps/mobile/app.config.ts", 'name: "T3 Code",', "kept"],
    [
      "apps/mobile/src/features/review/nativeReviewDiffAdapter.test.ts",
      'createNativeReviewDiffTheme("dark", "t3-code", appTheme("t3-code", "dark"));',
      "kept",
    ],
    ["docs/operations/x.md", "defaults to dark appearance and the `t3-code` palette", "kept"],
    ["README.md", "brew install --cask t3-code", "upstream-reference"],
  ])("classifies %s: %s as %s", (path, line, expected) => {
    expect(classOf(path, line)).toBe(expected);
  });

  it("leaves a name no rule knows unclassified, so the rename stops", () => {
    expect(classOf("apps/server/src/x.ts", 'const NEW_NAME = "t3wombat";')).toBe("unclassified");
  });

  it("gives every rule a distinct id", () => {
    const ids = FORK_RENAME_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
