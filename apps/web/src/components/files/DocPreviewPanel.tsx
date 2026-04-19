import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon, FileTextIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { openInPreferredEditor } from "../../editorPreferences";
import { readLocalApi } from "../../localApi";
import { cn } from "../../lib/utils";
import { readEnvironmentConnection } from "../../environments/runtime";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FileViewer } from "./FileViewer";
import {
  DocPreviewPanelShell,
  DocPreviewHeaderSkeleton,
  DocPreviewLoadingState,
  type DocPreviewPanelMode,
} from "./DocPreviewPanelShell";

export interface DocPreviewPanelProps {
  /** The file path to preview, relative to project root */
  relativePath: string;
  /** Project cwd */
  cwd: string;
  /** Environment ID used to resolve the RPC connection */
  environmentId: EnvironmentId;
  /** Panel display mode */
  mode: DocPreviewPanelMode;
  /** Close the panel */
  onClose: () => void;
  /** Optional list of touched paths to show in a tab bar */
  touchedPaths?: readonly string[];
}

interface FileState {
  status: "loading" | "success" | "error";
  contents: string;
  size: number;
  mtimeMs: number;
  error?: string;
}

const INITIAL_FILE_STATE: FileState = {
  status: "loading",
  contents: "",
  size: 0,
  mtimeMs: 0,
};

function extractFileName(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

function firstTouchedPath(touchedPaths: readonly string[] | undefined): string | undefined {
  if (!touchedPaths || touchedPaths.length === 0) return undefined;
  return touchedPaths[0];
}

export function DocPreviewPanel({
  relativePath: initialRelativePath,
  cwd,
  environmentId,
  mode,
  onClose,
  touchedPaths,
}: DocPreviewPanelProps) {
  const navigate = useNavigate();
  const firstPath = firstTouchedPath(touchedPaths);
  const [activeTab, setActiveTab] = useState<string>(firstPath ?? initialRelativePath);
  const activePath = firstPath != null ? activeTab : initialRelativePath;
  const [fileState, setFileState] = useState<FileState>(INITIAL_FILE_STATE);

  // Reset active tab when touchedPaths or initial path changes
  useEffect(() => {
    const fp = firstTouchedPath(touchedPaths);
    if (fp != null) {
      setActiveTab(fp);
    } else {
      setActiveTab(initialRelativePath);
    }
  }, [initialRelativePath, touchedPaths]);

  // Fetch file contents
  useEffect(() => {
    let cancelled = false;
    setFileState(INITIAL_FILE_STATE);

    const connection = readEnvironmentConnection(environmentId);
    if (!connection) {
      setFileState({
        status: "error",
        contents: "",
        size: 0,
        mtimeMs: 0,
        error: "No active connection for this environment.",
      });
      return;
    }

    void connection.client.projects
      .readFile({ cwd, relativePath: activePath })
      .then((result) => {
        if (cancelled) return;
        setFileState({
          status: "success",
          contents: result.contents,
          size: result.size,
          mtimeMs: result.mtimeMs,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to read file.";
        setFileState({
          status: "error",
          contents: "",
          size: 0,
          mtimeMs: 0,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activePath, cwd, environmentId]);

  const handleOpenInEditor = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    const fullPath = cwd.endsWith("/") ? `${cwd}${activePath}` : `${cwd}/${activePath}`;

    void openInPreferredEditor(api, fullPath).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to open file",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [cwd, activePath]);

  const handleOpenInFiles = useCallback(() => {
    void navigate({
      to: "/files",
      search: { file: activePath },
    });
  }, [navigate, activePath]);

  const showTabs = touchedPaths && touchedPaths.length > 1;

  const tabs = useMemo(() => {
    if (!showTabs) return null;

    return touchedPaths.map((path) => (
      <button
        key={path}
        type="button"
        className={cn(
          "rounded px-2 py-0.5 text-xs font-medium transition-colors",
          path === activeTab
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
        onClick={() => setActiveTab(path)}
        title={path}
      >
        {extractFileName(path)}
      </button>
    ));
  }, [showTabs, touchedPaths, activeTab]);

  const header = useMemo(() => {
    if (fileState.status === "loading") {
      return <DocPreviewHeaderSkeleton />;
    }

    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={activePath} />
            }
          >
            {extractFileName(activePath)}
          </TooltipTrigger>
          <TooltipPopup side="bottom" align="start" className="max-w-md">
            <span className="break-all font-mono text-xs">{activePath}</span>
          </TooltipPopup>
        </Tooltip>

        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                  onClick={handleOpenInEditor}
                  aria-label="Open in Editor"
                />
              }
            >
              <ExternalLinkIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Open in Editor</TooltipPopup>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                  onClick={handleOpenInFiles}
                  aria-label="Open in Files"
                />
              }
            >
              <FileTextIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Open in Files</TooltipPopup>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                  onClick={onClose}
                  aria-label="Close preview"
                />
              }
            >
              <XIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup>Close</TooltipPopup>
          </Tooltip>
        </div>
      </>
    );
  }, [fileState.status, activePath, handleOpenInEditor, handleOpenInFiles, onClose]);

  return (
    <DocPreviewPanelShell mode={mode} header={header} tabs={tabs}>
      {fileState.status === "loading" ? (
        <DocPreviewLoadingState label="Loading file preview..." />
      ) : fileState.status === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <FileTextIcon className="size-10 text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">Unable to load file</p>
          <p className="text-xs text-muted-foreground/80">{fileState.error}</p>
        </div>
      ) : (
        <FileViewer
          relativePath={activePath}
          contents={fileState.contents}
          size={fileState.size}
          mtimeMs={fileState.mtimeMs}
          cwd={cwd}
          className="h-full rounded-none border-0"
        />
      )}
    </DocPreviewPanelShell>
  );
}
