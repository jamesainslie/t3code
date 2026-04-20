import type { ProjectFileEntry } from "@t3tools/contracts";

export type DocsTreeNode =
  | { kind: "file"; name: string; path: string; oversized: boolean }
  | { kind: "directory"; name: string; path: string; children: DocsTreeNode[] };

export function buildDocsFileTree(
  files: readonly ProjectFileEntry[],
): DocsTreeNode[] {
  const root = new Map<string, DocsTreeNode>();

  for (const file of files) {
    const parts = file.relativePath.split("/");
    insertIntoMap(root, parts, 0, file);
  }

  return sortNodes(Array.from(root.values()));
}

function insertIntoMap(
  siblings: Map<string, DocsTreeNode>,
  parts: string[],
  depth: number,
  file: ProjectFileEntry,
): void {
  const name = parts[depth]!;

  if (depth === parts.length - 1) {
    // Leaf file node
    siblings.set(name, {
      kind: "file",
      name,
      path: file.relativePath,
      oversized: file.oversized,
    });
    return;
  }

  // Directory node
  let dir = siblings.get(name);
  if (!dir || dir.kind !== "directory") {
    dir = {
      kind: "directory",
      name,
      path: parts.slice(0, depth + 1).join("/"),
      children: [],
    };
    siblings.set(name, dir);
  }

  // Build a map from existing children so we can merge
  const childMap = new Map<string, DocsTreeNode>();
  if (dir.kind === "directory") {
    for (const child of dir.children) {
      childMap.set(child.name, child);
    }
  }

  insertIntoMap(childMap, parts, depth + 1, file);

  if (dir.kind === "directory") {
    dir.children = sortNodes(Array.from(childMap.values()));
  }
}

function sortNodes(nodes: DocsTreeNode[]): DocsTreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
