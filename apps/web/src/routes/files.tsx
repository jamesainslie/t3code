import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import type { FilesRouteSearch } from "../filesRouteSearch";
import { parseFilesRouteSearch } from "../filesRouteSearch";

function FilesRouteView() {
  const search = Route.useSearch();
  const selectedFile = search.file ?? null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Left pane: file tree */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-10 items-center border-b border-border px-3">
          <span className="text-sm font-medium">Files</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* FileTree will be wired here in wave 2 */}
          <p className="text-xs text-muted-foreground">Loading file tree...</p>
        </div>
      </div>
      {/* Right pane: file viewer */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedFile ? (
          <div className="flex-1 overflow-y-auto p-4">
            {/* FileViewer will be wired here in wave 2 */}
            <p className="text-sm text-muted-foreground">
              Selected: {selectedFile}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Select a file from the tree to preview
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/files")({
  validateSearch: (search) => parseFilesRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<FilesRouteSearch>(["file"])],
  },
  component: FilesRouteView,
});
