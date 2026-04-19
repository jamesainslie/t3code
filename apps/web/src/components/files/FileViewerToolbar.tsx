import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback } from "react";

import { openInPreferredEditor } from "../../editorPreferences";
import { readLocalApi } from "../../localApi";
import { toastManager } from "../ui/toast";

export interface FileViewerToolbarProps {
  relativePath: string;
  size: number;
  mtimeMs: number;
  cwd: string;
}

/**
 * Format a byte count for display.
 * - < 1024 bytes: "N B"
 * - < 1 MB: "N.N KB"
 * - >= 1 MB: "N.N MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewerToolbar({
  relativePath,
  size,
  cwd,
}: FileViewerToolbarProps) {
  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    const fullPath = cwd.endsWith("/")
      ? `${cwd}${relativePath}`
      : `${cwd}/${relativePath}`;

    void openInPreferredEditor(api, fullPath).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open file",
        description:
          error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [cwd, relativePath]);

  const handleCopyPath = useCallback(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard?.writeText
    ) {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: "Clipboard API unavailable.",
      });
      return;
    }

    void navigator.clipboard.writeText(relativePath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: relativePath,
        });
      },
      (error) => {
        toastManager.add({
          type: "error",
          title: "Failed to copy path",
          description:
            error instanceof Error ? error.message : "An error occurred.",
        });
      },
    );
  }, [relativePath]);

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
      <span
        className="min-w-0 flex-1 truncate font-mono"
        title={relativePath}
      >
        {relativePath}
      </span>

      <span className="shrink-0 tabular-nums">{formatFileSize(size)}</span>

      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
        onClick={handleOpenInEditor}
        title="Open in Editor"
        aria-label="Open in Editor"
      >
        <ExternalLinkIcon className="size-3" />
        <span className="hidden sm:inline">Open</span>
      </button>

      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
        onClick={handleCopyPath}
        title="Copy Path"
        aria-label="Copy Path"
      >
        <CopyIcon className="size-3" />
        <span className="hidden sm:inline">Copy</span>
      </button>
    </div>
  );
}
