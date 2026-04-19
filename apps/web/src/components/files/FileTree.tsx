import { memo, useCallback, useMemo, useState } from "react";
import { SearchIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { useTheme } from "../../hooks/useTheme";
import { VscodeEntryIcon } from "../chat/VscodeEntryIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { filterFileTree, flattenVisiblePaths, type FileTreeNode } from "./FileTreeState";

export interface FileTreeProps {
  files: FileTreeNode[];
  selectedPath: string | null;
  onSelectFile: (relativePath: string) => void;
  className?: string;
}

/**
 * Compute the depth of a node from its relativePath (number of `/` separators).
 */
function depthOf(relativePath: string): number {
  if (!relativePath) return 0;
  let count = 0;
  for (let i = 0; i < relativePath.length; i++) {
    if (relativePath[i] === "/") count++;
  }
  return count;
}

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".markdown");
}

const FileTreeRow = memo(function FileTreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  resolvedTheme,
  onToggleDir,
  onSelectFile,
}: {
  node: FileTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  resolvedTheme: "light" | "dark";
  onToggleDir: (relativePath: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const isDir = node.kind === "directory";
  const isOversized = node.oversized === true;
  const isMd = !isDir && isMarkdownFile(node.name);

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggleDir(node.relativePath);
    } else {
      onSelectFile(node.relativePath);
    }
  }, [isDir, node.relativePath, onToggleDir, onSelectFile]);

  const row = (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-sm",
        "hover:bg-muted/50 transition-colors",
        isSelected && "bg-accent text-accent-foreground",
        isOversized && "opacity-50",
      )}
      style={{ paddingLeft: `${depth * 16 + 6}px` }}
      aria-selected={isSelected}
      title={isOversized ? "File too large to preview (>5MB)" : undefined}
    >
      {isDir && (
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
            isExpanded && "rotate-90",
          )}
        />
      )}
      {!isDir && <span className="w-3.5 shrink-0" />}
      <VscodeEntryIcon
        pathValue={node.relativePath}
        kind={node.kind}
        theme={resolvedTheme}
        className="shrink-0"
      />
      <span className="min-w-0 truncate">{node.name}</span>
      {isMd && (
        <span
          className="ml-auto size-1.5 shrink-0 rounded-full bg-blue-400/60"
          aria-label="Markdown file"
        />
      )}
    </button>
  );

  if (isOversized) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div />}>{row}</TooltipTrigger>
        <TooltipPopup side="right">File too large to preview (&gt;5MB)</TooltipPopup>
      </Tooltip>
    );
  }

  return row;
});

export const FileTree = memo(function FileTree({
  files,
  selectedPath,
  onSelectFile,
  className,
}: FileTreeProps) {
  const { resolvedTheme } = useTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const filteredTree = useMemo(
    () => (searchQuery.trim() ? filterFileTree(files, searchQuery) : files),
    [files, searchQuery],
  );

  const visibleNodes = useMemo(
    () => flattenVisiblePaths(filteredTree, expandedDirs),
    [filteredTree, expandedDirs],
  );

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Search bar */}
      <div className="relative shrink-0 px-2 pb-2">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search files..."
          aria-label="Search files"
          className={cn(
            "h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm",
            "placeholder:text-muted-foreground/60",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-1" role="tree">
        {visibleNodes.length === 0 && searchQuery.trim() && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground/60">No files found</p>
        )}
        {visibleNodes.map((node) => (
          <FileTreeRow
            key={node.relativePath}
            node={node}
            depth={depthOf(node.relativePath)}
            isExpanded={expandedDirs.has(node.relativePath)}
            isSelected={selectedPath === node.relativePath}
            resolvedTheme={resolvedTheme}
            onToggleDir={toggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </div>
  );
});
