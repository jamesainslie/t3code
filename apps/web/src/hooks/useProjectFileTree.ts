import { useEffect, useRef, useState } from "react";
import type { ProjectFileChangeEvent } from "@t3tools/contracts";
import type { WsRpcClient } from "~/rpc/wsRpcClient";
import {
  buildFileTree,
  applyFileTreeEvent,
  type FileTreeNode,
} from "~/components/files/FileTreeState";

export interface UseProjectFileTreeResult {
  readonly tree: FileTreeNode[];
  readonly isLoading: boolean;
}

/**
 * Subscribe to real-time project file changes and maintain a FileTreeNode[]
 * that stays in sync with the server's file watcher.
 *
 * Returns `{ tree, isLoading }`. The tree is empty while the initial
 * snapshot has not arrived yet (isLoading=true).
 */
export function useProjectFileTree(
  rpcClient: WsRpcClient | null,
  cwd: string | null,
): UseProjectFileTreeResult {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Keep a mutable ref so the subscription callback always writes into the
  // latest tree without needing the state value in its dependency array.
  const treeRef = useRef<FileTreeNode[]>(tree);
  treeRef.current = tree;

  useEffect(() => {
    if (!rpcClient || !cwd) {
      setTree([]);
      setIsLoading(true);
      return;
    }

    let disposed = false;

    setTree([]);
    setIsLoading(true);

    const unsubscribe = rpcClient.projects.onFileChanges(
      { cwd, globs: ["**/*"], ignoreGlobs: [] },
      (event: ProjectFileChangeEvent) => {
        if (disposed) return;

        if (event._tag === "snapshot") {
          const nextTree = buildFileTree(event.files);
          treeRef.current = nextTree;
          setTree(nextTree);
          setIsLoading(false);
        } else {
          const nextTree = applyFileTreeEvent(treeRef.current, event);
          treeRef.current = nextTree;
          setTree(nextTree);
        }
      },
      {
        onResubscribe: () => {
          if (!disposed) {
            setIsLoading(true);
          }
        },
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [rpcClient, cwd]);

  return { tree, isLoading };
}
