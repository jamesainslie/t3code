import type { ProjectFileEntry, ProjectFileChangeEvent } from "@t3tools/contracts";

export interface FileTreeNode {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: "file" | "directory";
  readonly size?: number;
  readonly mtimeMs?: number;
  readonly oversized?: boolean;
  readonly children?: readonly FileTreeNode[];
}

/**
 * Sort comparator: directories first, then files, alphabetical within each group.
 */
function sortNodes(a: FileTreeNode, b: FileTreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Convert a flat list of ProjectFileEntry into a hierarchical FileTreeNode[].
 */
export function buildFileTree(files: readonly ProjectFileEntry[]): FileTreeNode[] {
  // Map of directory relativePath -> mutable children array
  const dirMap = new Map<string, FileTreeNode[]>();

  // Ensure a directory node exists for the given path, creating parents as needed.
  // Returns the children array for that directory.
  function ensureDir(dirPath: string): FileTreeNode[] {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;

    const children: FileTreeNode[] = [];
    dirMap.set(dirPath, children);

    const slashIdx = dirPath.lastIndexOf("/");
    const parentPath = slashIdx === -1 ? "" : dirPath.slice(0, slashIdx);
    const name = slashIdx === -1 ? dirPath : dirPath.slice(slashIdx + 1);

    const parentChildren = ensureDir(parentPath);
    parentChildren.push({
      name,
      relativePath: dirPath,
      kind: "directory",
      children,
    });

    return children;
  }

  // Root is represented by empty string
  dirMap.set("", []);

  for (const file of files) {
    const slashIdx = file.relativePath.lastIndexOf("/");
    const dirPath = slashIdx === -1 ? "" : file.relativePath.slice(0, slashIdx);
    const name = slashIdx === -1 ? file.relativePath : file.relativePath.slice(slashIdx + 1);

    const parentChildren = ensureDir(dirPath);
    parentChildren.push({
      name,
      relativePath: file.relativePath,
      kind: "file",
      size: file.size,
      mtimeMs: file.mtimeMs,
      oversized: file.oversized || undefined,
    });
  }

  // Sort all levels recursively
  function sortRecursive(nodes: FileTreeNode[]): FileTreeNode[] {
    nodes.sort(sortNodes);
    for (const node of nodes) {
      if (node.kind === "directory" && node.children) {
        sortRecursive(node.children as FileTreeNode[]);
      }
    }
    return nodes;
  }

  return sortRecursive(dirMap.get("")!);
}

/**
 * Insert a file node at the correct sorted position within a directory's children,
 * creating intermediate directory nodes as needed. Returns a new tree (immutable).
 */
function insertFile(
  tree: readonly FileTreeNode[],
  segments: readonly string[],
  fullPath: string,
  fileProps: { size: number; mtimeMs: number; oversized?: boolean },
): FileTreeNode[] {
  if (segments.length === 1) {
    // Insert the file at this level
    const newNode: FileTreeNode = {
      name: segments[0],
      relativePath: fullPath,
      kind: "file",
      size: fileProps.size,
      mtimeMs: fileProps.mtimeMs,
      oversized: fileProps.oversized || undefined,
    };
    const result = [...tree, newNode];
    result.sort(sortNodes);
    return result;
  }

  // Need to descend into or create a directory
  const dirName = segments[0];
  const rest = segments.slice(1);
  const dirPath = fullPath.slice(0, fullPath.length - rest.join("/").length - 1);

  const existingIdx = tree.findIndex((n) => n.kind === "directory" && n.name === dirName);
  if (existingIdx !== -1) {
    const existing = tree[existingIdx];
    const newChildren = insertFile(existing.children ?? [], rest, fullPath, fileProps);
    const result = [...tree];
    result[existingIdx] = { ...existing, children: newChildren };
    return result;
  }

  // Create new directory
  const newDirChildren = insertFile([], rest, fullPath, fileProps);
  const newDir: FileTreeNode = {
    name: dirName,
    relativePath: dirPath,
    kind: "directory",
    children: newDirChildren,
  };
  const result = [...tree, newDir];
  result.sort(sortNodes);
  return result;
}

/**
 * Remove a file from the tree by its relativePath. Also removes empty parent directories.
 * Returns null if the tree becomes empty at this level.
 */
function removeFile(
  tree: readonly FileTreeNode[],
  segments: readonly string[],
): FileTreeNode[] | null {
  if (segments.length === 1) {
    const filtered = tree.filter((n) => n.name !== segments[0]);
    return filtered.length > 0 ? filtered : null;
  }

  const dirName = segments[0];
  const rest = segments.slice(1);

  const result = tree.reduce<FileTreeNode[]>((acc, node) => {
    if (node.kind === "directory" && node.name === dirName) {
      const newChildren = removeFile(node.children ?? [], rest);
      if (newChildren !== null) {
        acc.push({ ...node, children: newChildren });
      }
      // If newChildren is null, the directory is empty — omit it
    } else {
      acc.push(node);
    }
    return acc;
  }, []);

  return result.length > 0 ? result : null;
}

/**
 * Update a file's metadata (size, mtimeMs) in the tree. Returns original tree if path not found.
 */
function updateFile(
  tree: readonly FileTreeNode[],
  segments: readonly string[],
  updates: { size: number; mtimeMs: number },
): FileTreeNode[] {
  if (segments.length === 1) {
    return tree.map((node) => {
      if (node.name === segments[0] && node.kind === "file") {
        return { ...node, size: updates.size, mtimeMs: updates.mtimeMs };
      }
      return node;
    });
  }

  const dirName = segments[0];
  const rest = segments.slice(1);

  return tree.map((node) => {
    if (node.kind === "directory" && node.name === dirName) {
      return { ...node, children: updateFile(node.children ?? [], rest, updates) };
    }
    return node;
  });
}

/**
 * Apply an incremental ProjectFileChangeEvent to the current tree.
 */
export function applyFileTreeEvent(
  tree: FileTreeNode[],
  event: ProjectFileChangeEvent,
): FileTreeNode[] {
  switch (event._tag) {
    case "snapshot":
      return buildFileTree(event.files);

    case "added": {
      const segments = event.relativePath.split("/");
      return insertFile(tree, segments, event.relativePath, {
        size: event.size,
        mtimeMs: event.mtimeMs,
      });
    }

    case "changed": {
      const segments = event.relativePath.split("/");
      return updateFile(tree, segments, {
        size: event.size,
        mtimeMs: event.mtimeMs,
      });
    }

    case "removed": {
      const segments = event.relativePath.split("/");
      return removeFile(tree, segments) ?? [];
    }

    case "turnTouchedDoc":
      // Handled elsewhere — no-op
      return tree;
  }
}

/**
 * Filter the tree to only include nodes matching the search query (case-insensitive).
 * Parent directories of matching files are kept even if they don't match.
 */
export function filterFileTree(tree: readonly FileTreeNode[], query: string): FileTreeNode[] {
  if (!query.trim()) return [...tree];

  const lowerQuery = query.toLowerCase();

  function filterRecursive(nodes: readonly FileTreeNode[]): FileTreeNode[] {
    const results: FileTreeNode[] = [];

    for (const node of nodes) {
      if (node.kind === "file") {
        if (node.name.toLowerCase().includes(lowerQuery)) {
          results.push(node);
        }
      } else {
        // Directory: recurse into children and keep if any children match
        const filteredChildren = filterRecursive(node.children ?? []);
        if (filteredChildren.length > 0) {
          results.push({ ...node, children: filteredChildren });
        }
      }
    }

    return results;
  }

  return filterRecursive(tree);
}

/**
 * Flatten the tree into a list of visible nodes given the current expansion state.
 * Used for virtualized/flat rendering.
 */
export function flattenVisiblePaths(
  tree: readonly FileTreeNode[],
  expandedDirs: ReadonlySet<string>,
): FileTreeNode[] {
  const result: FileTreeNode[] = [];

  function walk(nodes: readonly FileTreeNode[]): void {
    for (const node of nodes) {
      result.push(node);
      if (node.kind === "directory" && expandedDirs.has(node.relativePath) && node.children) {
        walk(node.children);
      }
    }
  }

  walk(tree);
  return result;
}
