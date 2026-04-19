import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { FilesRouteSearch } from "../filesRouteSearch";
import { parseFilesRouteSearch } from "../filesRouteSearch";
import { FileTree } from "../components/files/FileTree";
import { FileViewer } from "../components/files/FileViewer";
import { useProjectFileTree } from "../hooks/useProjectFileTree";
import { useFileContents } from "../hooks/useFileContents";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { readEnvironmentConnection } from "../environments/runtime";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import type { WsRpcClient } from "../rpc/wsRpcClient";

function useFirstProjectRpcClient(): {
  cwd: string | null;
  rpcClient: WsRpcClient | null;
} {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  return useMemo(() => {
    const project = projects[0] ?? null;
    if (!project) return { cwd: null, rpcClient: null };
    const connection = readEnvironmentConnection(project.environmentId);
    if (!connection) return { cwd: null, rpcClient: null };
    return { cwd: project.cwd, rpcClient: connection.client };
  }, [projects]);
}

function formatReadFileError(tag: string, relativePath: string): string {
  switch (tag) {
    case "NotFound":
      return `File not found: ${relativePath}`;
    case "TooLarge":
      return `File is too large to display: ${relativePath}`;
    case "PathOutsideRoot":
      return `Path is outside the project root: ${relativePath}`;
    case "NotReadable":
      return `File is not readable: ${relativePath}`;
    default:
      return `Failed to load file: ${relativePath}`;
  }
}

function FilesRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const selectedFile = search.file ?? null;

  const { cwd, rpcClient } = useFirstProjectRpcClient();
  const { tree, isLoading: treeLoading } = useProjectFileTree(rpcClient, cwd);
  const { data: fileData, isLoading: fileLoading, error: fileError } = useFileContents(
    rpcClient,
    cwd,
    selectedFile,
  );

  const handleSelectFile = useCallback(
    (relativePath: string) => {
      void navigate({
        to: "/files",
        search: { file: relativePath },
      });
    },
    [navigate],
  );

  // No project available
  if (!cwd) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
        <div className="flex h-dvh w-full items-center justify-center bg-background text-foreground">
          <p className="text-sm text-muted-foreground">
            Select a project from the sidebar to browse files
          </p>
        </div>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
        {/* Left pane: file tree */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
          <div className="flex h-10 items-center border-b border-border px-3 gap-2">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <span className="text-sm font-medium">Files</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {treeLoading ? (
              <div className="p-2">
                <p className="text-xs text-muted-foreground">Loading file tree...</p>
              </div>
            ) : tree.length === 0 ? (
              <div className="p-2">
                <p className="text-xs text-muted-foreground">No files found</p>
              </div>
            ) : (
              <FileTree
                files={tree}
                selectedPath={selectedFile}
                onSelectFile={handleSelectFile}
              />
            )}
          </div>
        </div>

        {/* Right pane: file viewer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedFile ? (
            fileLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">Loading file...</p>
              </div>
            ) : fileError ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-destructive">
                  {formatReadFileError(fileError.tag, fileError.relativePath)}
                </p>
              </div>
            ) : fileData ? (
              <div className="flex-1 overflow-y-auto">
                <FileViewer
                  relativePath={fileData.relativePath}
                  contents={fileData.contents}
                  size={fileData.size}
                  mtimeMs={fileData.mtimeMs}
                  cwd={cwd}
                  className="h-full rounded-none border-0"
                />
              </div>
            ) : null
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Select a file from the tree to preview
              </p>
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/files")({
  validateSearch: (search) => parseFilesRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<FilesRouteSearch>(["file"])],
  },
  component: FilesRouteView,
});
