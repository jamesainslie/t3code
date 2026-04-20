import { useEffect, useRef } from "react";
import type { ProjectFileChangeEvent } from "@t3tools/contracts";
import type { WsRpcClient } from "~/rpc/wsRpcClient";

export interface UseDocsAutoSurfaceOptions {
  /** The RPC client for file change subscription */
  rpcClient: WsRpcClient | null;
  /** Current project cwd */
  cwd: string | null;
  /** Current thread ID (to filter events for this thread) */
  threadId: string | null;
  /** Whether the preview panel is currently open */
  previewOpen: boolean;
  /** Callback to open preview with a file path and touched paths list */
  onAutoSurface: (relativePath: string, touchedPaths: readonly string[]) => void;
}

/**
 * Subscribes to project file change events and automatically opens
 * the DocPreviewPanel when a `turnTouchedDoc` event arrives for the
 * current thread.
 *
 * Does NOT auto-surface when the preview panel is already open so
 * the user is not disrupted while reading a different file.
 */
export function useDocsAutoSurface({
  rpcClient,
  cwd,
  threadId,
  previewOpen,
  onAutoSurface,
}: UseDocsAutoSurfaceOptions): void {
  // Use refs for values we only need inside the subscription callback
  // so that changes to these values don't re-subscribe the stream.
  const previewOpenRef = useRef(previewOpen);
  previewOpenRef.current = previewOpen;

  const onAutoSurfaceRef = useRef(onAutoSurface);
  onAutoSurfaceRef.current = onAutoSurface;

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  useEffect(() => {
    if (!rpcClient || !cwd || !threadId) {
      return;
    }

    let disposed = false;

    const unsubscribe = rpcClient.projects.onFileChanges(
      { cwd, globs: ["**/*"], ignoreGlobs: [] },
      (event: ProjectFileChangeEvent) => {
        if (disposed) return;
        if (event._tag !== "turnTouchedDoc") return;
        if (event.threadId !== threadIdRef.current) return;
        if (previewOpenRef.current) return;
        if (event.paths.length === 0) return;

        onAutoSurfaceRef.current(event.paths[0]!, event.paths);
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [rpcClient, cwd, threadId]);
}
