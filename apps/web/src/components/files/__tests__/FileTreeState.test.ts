import { describe, expect, it } from "vitest";
import type { ProjectFileEntry, ProjectFileChangeEvent } from "@t3tools/contracts";
import {
  buildFileTree,
  applyFileTreeEvent,
  filterFileTree,
  flattenVisiblePaths,
  type FileTreeNode,
} from "../FileTreeState";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  relativePath: string,
  overrides?: Partial<Omit<ProjectFileEntry, "relativePath">>,
): ProjectFileEntry {
  return {
    relativePath,
    size: overrides?.size ?? 100,
    mtimeMs: overrides?.mtimeMs ?? 1000,
    oversized: overrides?.oversized ?? false,
  } as ProjectFileEntry;
}

function collectPaths(nodes: readonly FileTreeNode[]): string[] {
  const paths: string[] = [];
  function walk(ns: readonly FileTreeNode[]): void {
    for (const n of ns) {
      paths.push(n.relativePath);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return paths;
}

function findNode(nodes: readonly FileTreeNode[], relativePath: string): FileTreeNode | undefined {
  for (const n of nodes) {
    if (n.relativePath === relativePath) return n;
    if (n.children) {
      const found = findNode(n.children, relativePath);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// buildFileTree
// ---------------------------------------------------------------------------

describe("buildFileTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("handles flat files at the root level", () => {
    const tree = buildFileTree([makeEntry("README.md"), makeEntry("package.json")]);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("package.json");
    expect(tree[1].name).toBe("README.md");
    expect(tree.every((n) => n.kind === "file")).toBe(true);
  });

  it("creates nested directory structure from paths", () => {
    const tree = buildFileTree([makeEntry("src/components/App.tsx"), makeEntry("src/main.ts")]);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src");
    expect(tree[0].kind).toBe("directory");

    const srcChildren = tree[0].children!;
    // "components" dir + "main.ts" file
    expect(srcChildren).toHaveLength(2);
    expect(srcChildren[0].kind).toBe("directory");
    expect(srcChildren[0].name).toBe("components");
    expect(srcChildren[1].kind).toBe("file");
    expect(srcChildren[1].name).toBe("main.ts");

    const compChildren = srcChildren[0].children!;
    expect(compChildren).toHaveLength(1);
    expect(compChildren[0].name).toBe("App.tsx");
    expect(compChildren[0].relativePath).toBe("src/components/App.tsx");
  });

  it("sorts directories before files, alphabetical within each group", () => {
    const tree = buildFileTree([
      makeEntry("zebra.ts"),
      makeEntry("alpha/one.ts"),
      makeEntry("beta/two.ts"),
      makeEntry("apple.ts"),
    ]);

    // Root should be: alpha/, beta/, apple.ts, zebra.ts
    expect(tree.map((n) => n.name)).toEqual(["alpha", "beta", "apple.ts", "zebra.ts"]);
  });

  it("handles deep nesting", () => {
    const tree = buildFileTree([makeEntry("a/b/c/d/e.ts")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a");

    const e = findNode(tree, "a/b/c/d/e.ts");
    expect(e).toBeDefined();
    expect(e!.kind).toBe("file");
    expect(e!.name).toBe("e.ts");
  });

  it("preserves file metadata (size, mtimeMs, oversized)", () => {
    const tree = buildFileTree([
      makeEntry("big.bin", { size: 10_000_000, mtimeMs: 5555, oversized: true }),
    ]);

    expect(tree[0].size).toBe(10_000_000);
    expect(tree[0].mtimeMs).toBe(5555);
    expect(tree[0].oversized).toBe(true);
  });

  it("does not set oversized when false", () => {
    const tree = buildFileTree([makeEntry("small.txt", { oversized: false })]);
    expect(tree[0].oversized).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyFileTreeEvent
// ---------------------------------------------------------------------------

describe("applyFileTreeEvent", () => {
  const baseTree = buildFileTree([
    makeEntry("src/index.ts", { size: 200 }),
    makeEntry("src/utils.ts", { size: 300 }),
    makeEntry("README.md", { size: 50 }),
  ]);

  describe("added", () => {
    it("adds a new file in an existing directory", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "added",
        relativePath: "src/helpers.ts",
        size: 150,
        mtimeMs: 2000,
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      const node = findNode(result, "src/helpers.ts");
      expect(node).toBeDefined();
      expect(node!.size).toBe(150);
    });

    it("creates intermediate directories for a deeply nested new file", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "added",
        relativePath: "src/lib/deep/newFile.ts",
        size: 50,
        mtimeMs: 3000,
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      const libDir = findNode(result, "src/lib");
      expect(libDir).toBeDefined();
      expect(libDir!.kind).toBe("directory");

      const deepDir = findNode(result, "src/lib/deep");
      expect(deepDir).toBeDefined();

      const file = findNode(result, "src/lib/deep/newFile.ts");
      expect(file).toBeDefined();
      expect(file!.size).toBe(50);
    });
  });

  describe("changed", () => {
    it("updates size and mtimeMs of an existing file", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "changed",
        relativePath: "src/index.ts",
        size: 999,
        mtimeMs: 4000,
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      const node = findNode(result, "src/index.ts");
      expect(node).toBeDefined();
      expect(node!.size).toBe(999);
      expect(node!.mtimeMs).toBe(4000);
    });
  });

  describe("removed", () => {
    it("removes a file from the tree", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "removed",
        relativePath: "README.md",
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      const node = findNode(result, "README.md");
      expect(node).toBeUndefined();
    });

    it("removes empty parent directories when the last file is removed", () => {
      // Build a tree with a single file in a nested directory
      const tree = buildFileTree([makeEntry("a/b/only.ts")]);
      expect(findNode(tree, "a")).toBeDefined();

      const event: ProjectFileChangeEvent = {
        _tag: "removed",
        relativePath: "a/b/only.ts",
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(tree, event);
      // Both a/ and a/b/ should be removed since they are now empty
      expect(findNode(result, "a")).toBeUndefined();
      expect(findNode(result, "a/b")).toBeUndefined();
      expect(result).toHaveLength(0);
    });

    it("keeps sibling files when removing one file from a directory", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "removed",
        relativePath: "src/utils.ts",
      } as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      expect(findNode(result, "src/utils.ts")).toBeUndefined();
      expect(findNode(result, "src/index.ts")).toBeDefined();
      expect(findNode(result, "src")).toBeDefined();
    });
  });

  describe("snapshot", () => {
    it("rebuilds the entire tree from a snapshot event", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "snapshot",
        files: [makeEntry("new/file.ts", { size: 42 })],
      } as unknown as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("new");
      const file = findNode(result, "new/file.ts");
      expect(file).toBeDefined();
      expect(file!.size).toBe(42);
    });
  });

  describe("turnTouchedDoc", () => {
    it("returns the tree unchanged", () => {
      const event: ProjectFileChangeEvent = {
        _tag: "turnTouchedDoc",
        threadId: "thread-1",
        turnId: "turn-1",
        paths: ["some/path.md"],
      } as unknown as ProjectFileChangeEvent;

      const result = applyFileTreeEvent(baseTree, event);
      expect(result).toBe(baseTree);
    });
  });
});

// ---------------------------------------------------------------------------
// filterFileTree
// ---------------------------------------------------------------------------

describe("filterFileTree", () => {
  const tree = buildFileTree([
    makeEntry("src/components/App.tsx"),
    makeEntry("src/components/Button.tsx"),
    makeEntry("src/utils/helpers.ts"),
    makeEntry("README.md"),
    makeEntry("package.json"),
  ]);

  it("returns the full tree for an empty query", () => {
    const result = filterFileTree(tree, "");
    expect(collectPaths(result)).toEqual(collectPaths(tree));
  });

  it("filters files by name, case-insensitive", () => {
    const result = filterFileTree(tree, "app");
    const paths = collectPaths(result);
    expect(paths).toContain("src/components/App.tsx");
    // Button should not be in the result
    expect(paths).not.toContain("src/components/Button.tsx");
  });

  it("keeps parent directories of matching files", () => {
    const result = filterFileTree(tree, "helpers");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].kind).toBe("directory");
    const utils = result[0].children!;
    expect(utils).toHaveLength(1);
    expect(utils[0].name).toBe("utils");
    const files = utils[0].children!;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("helpers.ts");
  });

  it("returns empty array when nothing matches", () => {
    const result = filterFileTree(tree, "zzzznonexistent");
    expect(result).toHaveLength(0);
  });

  it("matches case-insensitively", () => {
    const result = filterFileTree(tree, "README");
    const paths = collectPaths(result);
    expect(paths).toContain("README.md");

    const result2 = filterFileTree(tree, "readme");
    const paths2 = collectPaths(result2);
    expect(paths2).toContain("README.md");
  });

  it("matches partial file names", () => {
    const result = filterFileTree(tree, ".tsx");
    const paths = collectPaths(result);
    expect(paths).toContain("src/components/App.tsx");
    expect(paths).toContain("src/components/Button.tsx");
    expect(paths).not.toContain("src/utils/helpers.ts");
  });
});

// ---------------------------------------------------------------------------
// flattenVisiblePaths
// ---------------------------------------------------------------------------

describe("flattenVisiblePaths", () => {
  const tree = buildFileTree([
    makeEntry("src/components/App.tsx"),
    makeEntry("src/utils/helpers.ts"),
    makeEntry("README.md"),
  ]);

  it("returns only root items when all directories are collapsed", () => {
    const result = flattenVisiblePaths(tree, new Set());
    // Root: src/ (dir) and README.md (file)
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("src");
    expect(result[1].name).toBe("README.md");
  });

  it("shows children of an expanded directory", () => {
    const result = flattenVisiblePaths(tree, new Set(["src"]));
    // src/, components/, utils/, README.md
    const names = result.map((n) => n.name);
    expect(names).toContain("src");
    expect(names).toContain("components");
    expect(names).toContain("utils");
    expect(names).toContain("README.md");
    // But not the leaf files since their parent dirs aren't expanded
    expect(names).not.toContain("App.tsx");
    expect(names).not.toContain("helpers.ts");
  });

  it("shows deeply nested children when all ancestor directories are expanded", () => {
    const result = flattenVisiblePaths(tree, new Set(["src", "src/components", "src/utils"]));
    const names = result.map((n) => n.name);
    expect(names).toContain("App.tsx");
    expect(names).toContain("helpers.ts");
  });

  it("preserves sorted order (directories first)", () => {
    const result = flattenVisiblePaths(tree, new Set(["src"]));
    const srcIdx = result.findIndex((n) => n.name === "src");
    const readmeIdx = result.findIndex((n) => n.name === "README.md");
    // src/ (directory) should come before README.md (file)
    expect(srcIdx).toBeLessThan(readmeIdx);
  });

  it("only expands directories that are in the expandedDirs set", () => {
    // Expand src but not src/components
    const result = flattenVisiblePaths(tree, new Set(["src"]));
    const names = result.map((n) => n.name);
    expect(names).toContain("components");
    expect(names).not.toContain("App.tsx");
  });
});
