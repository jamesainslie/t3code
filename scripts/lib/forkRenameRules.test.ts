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
      "kept",
    ],
    ["apps/server/src/x.ts", '"mcp__t3-code__t3_thread_list",', "agent-facing"],
    ["README.md", "Fork of https://github.com/pingdotgg/t3code", "upstream-reference"],
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
