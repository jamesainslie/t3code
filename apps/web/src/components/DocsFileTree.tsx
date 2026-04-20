import { memo, useCallback, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import type { ProjectFileEntry } from "@t3tools/contracts";
import { buildDocsFileTree, type DocsTreeNode } from "~/lib/docsFileTree";
import { cn } from "~/lib/utils";

interface DocsFileTreeProps {
  files: readonly ProjectFileEntry[];
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
}

export const DocsFileTree = memo(function DocsFileTree(
  props: DocsFileTreeProps,
) {
  const { files, selectedPath, onSelectFile } = props;
  const tree = useMemo(() => buildDocsFileTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const renderNode = (node: DocsTreeNode, depth: number) => {
    const paddingLeft = 8 + depth * 16;

    if (node.kind === "directory") {
      const isExpanded = expandedDirs[node.path] ?? true;
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent/50"
            style={{ paddingLeft: `${paddingLeft}px` }}
            onClick={() => toggleDir(node.path)}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
                isExpanded && "rotate-90",
              )}
            />
            {isExpanded ? (
              <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-[11px] text-muted-foreground/90">
              {node.name}
            </span>
          </button>
          {isExpanded &&
            node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const isSelected = node.path === selectedPath;
    return (
      <button
        key={`file:${node.path}`}
        type="button"
        data-selected={isSelected ? "true" : undefined}
        data-oversized={node.oversized ? "true" : undefined}
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-accent/50",
          isSelected && "bg-accent",
          node.oversized && "opacity-50",
        )}
        style={{ paddingLeft: `${paddingLeft + 18}px` }}
        onClick={() => !node.oversized && onSelectFile(node.path)}
        title={node.oversized ? "File too large to preview" : node.path}
      >
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
        <span className="truncate font-mono text-[11px] text-foreground/90">
          {node.name}
        </span>
      </button>
    );
  };

  if (tree.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
        No markdown files found
      </div>
    );
  }

  return (
    <div className="space-y-0.5 py-1">
      {tree.map((node) => renderNode(node, 0))}
    </div>
  );
});
