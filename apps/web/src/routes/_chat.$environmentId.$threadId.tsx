import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import {
  type DocsRouteSearch,
  parseDocsRouteSearch,
  stripDocsSearchParams,
} from "../docsRouteSearch";
import {
  closePreviewRouteSearch,
  type PreviewRouteSearch,
  parsePreviewRouteSearch,
  stripPreviewSearchParams,
} from "../previewRouteSearch";
import {
  DocsPanelHeaderSkeleton,
  DocsPanelLoadingState,
  DocsPanelShell,
  type DocsPanelMode,
} from "../components/DocsPanelShell";
import {
  DocPreviewHeaderSkeleton,
  DocPreviewLoadingState,
  DocPreviewPanelShell,
  type DocPreviewPanelMode,
} from "../components/files/DocPreviewPanelShell";
import { readEnvironmentConnection } from "../environments/runtime";
import { useDocsAutoSurface } from "../hooks/useDocsAutoSurface";
import { useDocsChangeToast } from "../hooks/useDocsChangeToast";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  collectMarkdownActivityPreviewPaths,
  findMarkdownActivityPreviewSignal,
} from "../lib/markdownActivityPreview";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  selectEnvironmentState,
  selectProjectByRef,
  selectThreadExistsByRef,
  useStore,
} from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DocsPanel = lazy(() => import("../components/DocsPanel"));
const DOCS_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_docs_sidebar_width";
const DOCS_INLINE_DEFAULT_WIDTH = "clamp(24rem,40vw,40rem)";
const DOCS_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const PREVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_doc_preview_sidebar_width";
const PREVIEW_INLINE_DEFAULT_WIDTH = "clamp(24rem,40vw,42rem)";
const PREVIEW_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;

const DocsLoadingFallback = (props: { mode: DocsPanelMode }) => (
  <DocsPanelShell mode={props.mode} header={<DocsPanelHeaderSkeleton />}>
    <DocsPanelLoadingState label="Loading docs viewer..." />
  </DocsPanelShell>
);

const LazyDocsPanel = (props: { mode: DocsPanelMode }) => (
  <Suspense fallback={<DocsLoadingFallback mode={props.mode} />}>
    <DocsPanel mode={props.mode} />
  </Suspense>
);

const DocPreviewPanel = lazy(() =>
  import("../components/files/DocPreviewPanel").then((module) => ({
    default: module.DocPreviewPanel,
  })),
);

const DocPreviewLoadingFallback = (props: { mode: DocPreviewPanelMode }) => (
  <DocPreviewPanelShell mode={props.mode} header={<DocPreviewHeaderSkeleton />}>
    <DocPreviewLoadingState label="Loading file preview..." />
  </DocPreviewPanelShell>
);

const LazyDocPreviewPanel = (props: {
  relativePath: string;
  cwd: string;
  environmentId: NonNullable<ReturnType<typeof resolveThreadRouteRef>>["environmentId"];
  mode: DocPreviewPanelMode;
  onClose: () => void;
  touchedPaths?: readonly string[];
}) => (
  <Suspense fallback={<DocPreviewLoadingFallback mode={props.mode} />}>
    <DocPreviewPanel {...props} />
  </Suspense>
);

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const docsOpen = search.docs === "1";
  const previewOpen = typeof search.preview === "string";
  const previewPath = previewOpen ? search.preview : undefined;
  const activeProject = useStore((store) =>
    serverThread
      ? selectProjectByRef(store, {
          environmentId: serverThread.environmentId,
          projectId: serverThread.projectId,
        })
      : undefined,
  );
  const activeCwd = serverThread?.worktreePath ?? activeProject?.cwd ?? null;
  const [previewTouchedPaths, setPreviewTouchedPaths] = useState<readonly string[] | null>(null);
  useDocsChangeToast({
    environmentId: threadRef?.environmentId ?? null,
    cwd: activeCwd,
    openDocsPath: docsOpen ? (search.docsPath ?? null) : null,
  });
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);
  const closeDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, threadRef]);
  const closeDocs = useCallback(() => {
    if (!threadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDocsSearchParams(previous);
        return { ...rest };
      },
    });
  }, [navigate, threadRef]);
  const openDocs = useCallback(() => {
    if (!threadRef) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => ({
        ...previous,
        docs: "1" as const,
      }),
    });
  }, [navigate, threadRef]);
  const navigatePreview = useCallback(
    (relativePath: string) => {
      if (!threadRef) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
        search: (previous) => {
          const rest = stripPreviewSearchParams(previous);
          return { ...rest, preview: relativePath };
        },
      });
    },
    [navigate, threadRef],
  );
  const openPreview = useCallback(
    (relativePath: string) => {
      setPreviewTouchedPaths(null);
      navigatePreview(relativePath);
    },
    [navigatePreview],
  );
  const openAutoPreview = useCallback(
    (relativePath: string, touchedPaths: readonly string[]) => {
      setPreviewTouchedPaths(touchedPaths);
      navigatePreview(relativePath);
    },
    [navigatePreview],
  );
  const closePreview = useCallback(() => {
    if (!threadRef) return;
    setPreviewTouchedPaths(null);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: closePreviewRouteSearch,
    });
  }, [navigate, threadRef]);
  const autoSurfaceClient = threadRef
    ? (readEnvironmentConnection(threadRef.environmentId)?.client ?? null)
    : null;
  const lastActivityPreviewSignalKeyRef = useRef<string | null>(null);
  const activityPreviewSignal = useMemo(
    () =>
      findMarkdownActivityPreviewSignal({
        activities: serverThread?.activities ?? [],
        cwd: activeCwd,
        turnId: serverThread?.latestTurn?.turnId ?? null,
      }),
    [activeCwd, serverThread?.activities, serverThread?.latestTurn?.turnId],
  );
  const chatMentionedMarkdownPaths = useMemo(
    () =>
      collectMarkdownActivityPreviewPaths({
        activities: serverThread?.activities ?? [],
        cwd: activeCwd,
      }),
    [activeCwd, serverThread?.activities],
  );
  useDocsAutoSurface({
    rpcClient: autoSurfaceClient,
    cwd: activeCwd,
    threadId: threadRef?.threadId ?? null,
    previewOpen,
    onAutoSurface: openAutoPreview,
  });

  useEffect(() => {
    if (!activityPreviewSignal) {
      return;
    }
    if (lastActivityPreviewSignalKeyRef.current === activityPreviewSignal.key) {
      return;
    }

    lastActivityPreviewSignalKeyRef.current = activityPreviewSignal.key;
    if (!previewOpen) {
      openAutoPreview(activityPreviewSignal.paths[0]!, activityPreviewSignal.paths);
    }
  }, [activityPreviewSignal, openAutoPreview, previewOpen]);

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const rightPanelOpen = diffOpen || docsOpen || previewOpen;
  const previewTogglePath =
    previewPath ?? previewTouchedPaths?.[0] ?? chatMentionedMarkdownPaths[0];
  const markdownPreviewAvailable = previewOpen || previewTogglePath !== undefined;
  const toggleMarkdownPreview = () => {
    if (previewOpen) {
      closePreview();
      return;
    }
    if (previewTogglePath) {
      openPreview(previewTogglePath);
    }
  };
  const previewTouchedPathsForActivePath = previewPath
    ? Array.from(
        new Set([previewPath, ...(previewTouchedPaths ?? []), ...chatMentionedMarkdownPaths]),
      )
    : undefined;

  if (!shouldUseDiffSheet) {
    const showPreviewSidebar = previewPath !== undefined && !diffOpen;
    const showDocsSidebar = docsOpen && !diffOpen && !showPreviewSidebar;

    return (
      <>
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markDiffOpened}
            onPreviewFile={openPreview}
            markdownPreviewOpen={previewOpen}
            markdownPreviewAvailable={markdownPreviewAvailable}
            onToggleMarkdownPreview={toggleMarkdownPreview}
            reserveTitleBarControlInset={!rightPanelOpen}
            routeKind="server"
          />
        </SidebarInset>
        {shouldRenderDiffContent && (
          <DiffPanelInlineSidebar
            diffOpen={diffOpen}
            onCloseDiff={closeDiff}
            onOpenDiff={openDiff}
            renderDiffContent={shouldRenderDiffContent}
          />
        )}
        {showDocsSidebar && (
          <SidebarProvider
            defaultOpen={false}
            open={docsOpen}
            onOpenChange={(open) => (open ? openDocs() : closeDocs())}
            className="w-auto min-h-0 flex-none bg-transparent"
            style={{ "--sidebar-width": DOCS_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
          >
            <Sidebar
              side="right"
              collapsible="offcanvas"
              className="border-l border-border bg-card text-foreground"
              resizable={{
                minWidth: DOCS_INLINE_SIDEBAR_MIN_WIDTH,
                storageKey: DOCS_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
              }}
            >
              <LazyDocsPanel mode="sidebar" />
              <SidebarRail />
            </Sidebar>
          </SidebarProvider>
        )}
        {showPreviewSidebar && activeCwd && (
          <SidebarProvider
            defaultOpen={false}
            open={previewOpen}
            onOpenChange={(open) => (open ? navigatePreview(previewPath) : closePreview())}
            className="w-auto min-h-0 flex-none bg-transparent"
            style={{ "--sidebar-width": PREVIEW_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
          >
            <Sidebar
              side="right"
              collapsible="offcanvas"
              className="border-l border-border bg-card text-foreground"
              resizable={{
                minWidth: PREVIEW_INLINE_SIDEBAR_MIN_WIDTH,
                storageKey: PREVIEW_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
              }}
            >
              <LazyDocPreviewPanel
                relativePath={previewPath}
                cwd={activeCwd}
                environmentId={threadRef.environmentId}
                mode="sidebar"
                onClose={closePreview}
                {...(previewTouchedPathsForActivePath
                  ? { touchedPaths: previewTouchedPathsForActivePath }
                  : {})}
              />
              <SidebarRail />
            </Sidebar>
          </SidebarProvider>
        )}
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          onPreviewFile={openPreview}
          markdownPreviewOpen={previewOpen}
          markdownPreviewAvailable={markdownPreviewAvailable}
          onToggleMarkdownPreview={toggleMarkdownPreview}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </RightPanelSheet>
      <RightPanelSheet open={docsOpen && !diffOpen && !previewOpen} onClose={closeDocs}>
        <LazyDocsPanel mode="sheet" />
      </RightPanelSheet>
      <RightPanelSheet open={previewOpen && !diffOpen} onClose={closePreview}>
        {previewPath && activeCwd ? (
          <LazyDocPreviewPanel
            relativePath={previewPath}
            cwd={activeCwd}
            environmentId={threadRef.environmentId}
            mode="sheet"
            onClose={closePreview}
            {...(previewTouchedPathsForActivePath
              ? { touchedPaths: previewTouchedPathsForActivePath }
              : {})}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => ({
    ...parseDiffRouteSearch(search),
    ...parseDocsRouteSearch(search),
    ...parsePreviewRouteSearch(search),
  }),
  search: {
    middlewares: [
      retainSearchParams<DiffRouteSearch & DocsRouteSearch & PreviewRouteSearch>([
        "diff",
        "docs",
        "preview",
      ]),
    ],
  },
  component: ChatThreadRouteView,
});
