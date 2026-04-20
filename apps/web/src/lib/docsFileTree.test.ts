import { describe, expect, it } from "vitest";

import { buildDocsFileTree } from "./docsFileTree";
import type { ProjectFileEntry } from "@t3tools/contracts";

const entry = (path: string, oversized = false): ProjectFileEntry =>
  ({
    relativePath: path,
    size: 100,
    mtimeMs: 1,
    oversized,
  }) as ProjectFileEntry;

describe("buildDocsFileTree", () => {
  it("groups files into directories", () => {
    const tree = buildDocsFileTree([
      entry("README.md"),
      entry("docs/guide.md"),
      entry("docs/api/ref.md"),
    ]);
    expect(tree).toHaveLength(2); // README.md + docs/
    const docsDir = tree.find((n) => n.kind === "directory" && n.name === "docs");
    expect(docsDir).toBeDefined();
    if (docsDir?.kind === "directory") {
      expect(docsDir.children).toHaveLength(2); // guide.md + api/
    }
  });

  it("sorts directories before files, then alphabetically", () => {
    const tree = buildDocsFileTree([entry("z.md"), entry("a/b.md"), entry("a.md")]);
    expect(tree[0]!.name).toBe("a");
    expect(tree[1]!.name).toBe("a.md");
    expect(tree[2]!.name).toBe("z.md");
  });

  it("marks oversized files", () => {
    const tree = buildDocsFileTree([entry("big.md", true)]);
    const file = tree[0]!;
    expect(file.kind).toBe("file");
    if (file.kind === "file") {
      expect(file.oversized).toBe(true);
    }
  });

  it("handles empty input", () => {
    const tree = buildDocsFileTree([]);
    expect(tree).toEqual([]);
  });

  it("handles deeply nested files", () => {
    const tree = buildDocsFileTree([entry("a/b/c/d.md")]);
    expect(tree).toHaveLength(1);
    const a = tree[0]!;
    expect(a.kind).toBe("directory");
    if (a.kind === "directory") {
      expect(a.children[0]!.kind).toBe("directory");
    }
  });
});
