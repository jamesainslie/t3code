import { scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type MdreviewAdapters,
  MdreviewRenderer,
  T3FileAdapter,
  T3NullMessagingAdapter,
  T3StorageAdapter,
  type RpcClient,
} from "@t3tools/mdreview-host";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FileTextIcon, FolderTreeIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { useTheme } from "../hooks/useTheme";
import { useDocsFileState } from "../lib/docsFileState";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import {
  type DocsMode,
  parseDocsRouteSearch,
  stripDocsSearchParams,
} from "../docsRouteSearch";
import { DocsFileTree } from "./DocsFileTree";
import {
  DocsPanelLoadingState,
  DocsPanelShell,
  type DocsPanelMode,
} from "./DocsPanelShell";

// ── RPC bridge ────────────────────────────────────────────────────────

function buildRpcClientForEnvironment(
  environmentId: EnvironmentId,
  cwd: string,
): RpcClient | null {
  const api = readEnvironmentApi(environmentId);
  if (!api) return null;

  const client: RpcClient = {
    call: async <I, O>(method: string, input: I): Promise<O> => {
      if (method === "projects.readFile") {
        return api.projectFiles.readFile(input as never) as never;
      }
      throw new Error(`Unsupported RPC method: ${method}`);
    },
    stream: <I, O>(
      method: string,
      input: I,
      handler: (event: O) => void,
    ): (() => void) => {
      if (method === "subscribeProjectFileChanges") {
        return api.projectFiles.onFileChange(
          input as never,
          handler as never,
        );
      }
      throw new Error(`Unsupported RPC stream: ${method}`);
    },
  };
  return client;
}

// ── Adapters memo ─────────────────────────────────────────────────────

function useAdapters(
  environmentId: EnvironmentId | null,
  cwd: string | null,
): MdreviewAdapters | null {
  return useMemo(() => {
    if (!environmentId || !cwd) return null;

    const rpcClient = buildRpcClientForEnvironment(environmentId, cwd);
    if (!rpcClient) return null;

    const file = new T3FileAdapter({ client: rpcClient, cwd });
    const storage = new T3StorageAdapter({ backing: localStorage });
    const messaging = new T3NullMessagingAdapter();

    return { file, storage, messaging };
  }, [environmentId, cwd]);
}

// ── File content loader ───────────────────────────────────────────────

function useFileContent(
  adapters: MdreviewAdapters | null,
  selectedPath: string | null,
): { content: string | null; isLoading: boolean } {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (!adapters || !selectedPath) {
      setContent(null);
      setIsLoading(false);
      return;
    }

    const loadId = ++loadIdRef.current;
    setIsLoading(true);

    adapters.file.readFile(selectedPath).then(
      (text: string) => {
        if (loadId === loadIdRef.current) {
          setContent(text);
          setIsLoading(false);
        }
      },
      () => {
        if (loadId === loadIdRef.current) {
          setContent(null);
          setIsLoading(false);
        }
      },
    );

    // Re-fetch on file change
    const unwatch = adapters.file.watch(selectedPath, () => {
      const refreshId = ++loadIdRef.current;
      adapters.file.readFile(selectedPath).then(
        (text: string) => {
          if (refreshId === loadIdRef.current) {
            setContent(text);
          }
        },
        () => {
          // Ignore read errors on refresh
        },
      );
    });

    return () => {
      ++loadIdRef.current;
      unwatch();
    };
  }, [adapters, selectedPath]);

  return { content, isLoading };
}

// ── Component ─────────────────────────────────────────────────────────

interface DocsPanelProps {
  mode?: DocsPanelMode;
}

export default function DocsPanel({ mode = "inline" }: DocsPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();

  // Route params and search
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const docsSearch = useSearch({
    strict: false,
    select: parseDocsRouteSearch,
  });
  const selectedPath = docsSearch.docsPath ?? null;
  const docsMode: DocsMode = docsSearch.docsMode ?? "preview";

  // Thread / project / cwd
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const environmentId = activeThread?.environmentId ?? null;

  // File state + adapters
  const { files, isPending } = useDocsFileState({ environmentId, cwd: activeCwd });
  const adapters = useAdapters(environmentId, activeCwd);
  const { content, isLoading } = useFileContent(
    docsMode === "preview" ? adapters : null,
    selectedPath,
  );

  // ── Navigation helpers ────────────────────────────────────────────

  const closeDocs = useCallback(() => {
    if (!routeThreadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(routeThreadRef),
      search: (previous) => stripDocsSearchParams(previous),
    });
  }, [navigate, routeThreadRef]);

  const selectFile = useCallback(
    (path: string) => {
      if (!routeThreadRef) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(routeThreadRef),
        search: (previous) => ({
          ...stripDocsSearchParams(previous),
          docs: "1" as const,
          docsPath: path,
          docsMode: "preview" as const,
        }),
      });
    },
    [navigate, routeThreadRef],
  );

  const toggleMode = useCallback(() => {
    if (!routeThreadRef) return;
    const nextMode: DocsMode = docsMode === "preview" ? "browser" : "preview";
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(routeThreadRef),
      search: (previous) => ({
        ...stripDocsSearchParams(previous),
        docs: "1" as const,
        ...(selectedPath ? { docsPath: selectedPath } : {}),
        docsMode: nextMode,
      }),
    });
  }, [navigate, routeThreadRef, docsMode, selectedPath]);

  // ── Determine content view ────────────────────────────────────────

  const showBrowser = docsMode === "browser" || !selectedPath;
  const showPreview = docsMode === "preview" && selectedPath !== null;

  // ── Header ────────────────────────────────────────────────────────

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          onClick={toggleMode}
          aria-label={
            showBrowser ? "Switch to preview mode" : "Switch to browser mode"
          }
          title={showBrowser ? "Preview" : "Browse files"}
        >
          {showBrowser ? (
            <FileTextIcon className="size-3" />
          ) : (
            <FolderTreeIcon className="size-3" />
          )}
        </button>
        {selectedPath && (
          <span className="truncate font-mono text-[11px] text-muted-foreground/90">
            {selectedPath}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md border border-border/70 bg-background/90 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          onClick={closeDocs}
          aria-label="Close docs panel"
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </>
  );

  // ── Content ───────────────────────────────────────────────────────

  let body: React.ReactNode;

  if (showBrowser || !showPreview) {
    body = isPending ? (
      <DocsPanelLoadingState label="Loading file list..." />
    ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <DocsFileTree
          files={files}
          selectedPath={selectedPath}
          onSelectFile={selectFile}
        />
      </div>
    );
  } else if (isLoading || content === null) {
    body = <DocsPanelLoadingState label="Loading document..." />;
  } else {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <MdreviewRenderer
          source={content}
          adapters={adapters!}
          theme={resolvedTheme}
        />
      </div>
    );
  }

  return (
    <DocsPanelShell mode={mode} header={headerRow}>
      {body}
    </DocsPanelShell>
  );
}
