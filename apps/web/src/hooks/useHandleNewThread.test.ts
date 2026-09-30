import { describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeMode } from "@t3tools/contracts";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree",
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  let routeDraftId: string | null = null;
  let threadShells: Record<string, { readonly modelSelection: unknown }> = {};
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
    addThreadReference: vi.fn(),
    setPrompt: vi.fn(),
  };

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    get projectFileRead() {
      return projectFileRead;
    },
    get targetSettings() {
      return targetSettings;
    },
    get routeDraftId() {
      return routeDraftId;
    },
    set routeDraftId(value: string | null) {
      routeDraftId = value;
    },
    readThreadShell(ref: { readonly threadId: string }) {
      return threadShells[ref.threadId] ?? null;
    },
    set threadShells(value: Record<string, { readonly modelSelection: unknown }>) {
      threadShells = value;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree",
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      routeDraftId = null;
      threadShells = {};
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      draftStore.setModelSelection.mockClear();
      draftStore.addThreadReference.mockClear();
      draftStore.setPrompt.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : new Map([
          [
            "environment-primary",
            {
              settings: {
                ...testState.targetSettings,
                newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
              },
            },
          ],
          ["environment-ssh", { settings: testState.targetSettings }],
        ]),
}));
vi.mock("@t3tools/client-runtime/environment", () => ({
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", async (importOriginal) => ({
  // The real module backs the thread chip helpers; only defaults are pinned.
  ...(await importOriginal<typeof import("@t3tools/contracts")>()),
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  // Environment settings pass through; the tests set project fields on the
  // project record, which the hook still honors until the server folds them.
  // With a file argument the env mode resolves like the real chain.
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.draftStore,
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => ({
  readProjects: () => [
    {
      id: "project-remote",
      environmentId: "environment-ssh",
      workspaceRoot: "/remote/project",
      defaultThreadEnvMode: null,
      defaultModelSelection: null,
    },
  ],
  readThreadShell: (ref: { readonly threadId: string }) => testState.readThreadShell(ref),
  useProjects: () => [],
  useThread: () => null,
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({
  resolveThreadRouteTarget: () =>
    testState.routeDraftId === null ? null : { kind: "draft", draftId: testState.routeDraftId },
}));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import {
  buildContinuePrompt,
  buildThreadContextRecord,
} from "@t3tools/shared/threadContextReference";

import { continueInNewThreadOptions, useNewThreadHandler } from "./useHandleNewThread";

const sourceThread = {
  id: "thread-source",
  projectId: "project-remote",
  title: "Fix login redirect",
  branch: "feature/login",
  worktreePath: null,
} as never;
const sourceModelSelection = { instanceId: "codex", model: "gpt-5.5" };

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "uses the target environment's %s permissions for new threads",
    async (runtimeMode) => {
      testState.reset(draft);
      testState.targetSettings.defaultRuntimeMode = runtimeMode;
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = useNewThreadHandler()(projectRef);
      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ runtimeMode }),
      );
    },
  );

  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses the target environment's start-from-origin default of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;
      const pendingOpen = openThread(projectRef);

      testState.completeProjectFileRead(null);
      const opened = await pendingOpen;

      expect(opened).toEqual({
        draftId: draft?.draftId ?? "draft-delayed",
        threadId: draft?.threadId ?? "thread-delayed",
      });
      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
      if (draft) {
        expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
          draft.draftId,
          expect.objectContaining({ envMode: "worktree", startFromOrigin }),
        );
      }
    },
  );

  it.each([true, false])(
    "preserves an explicit start-from-origin choice of %s",
    async (startFromOrigin) => {
      testState.reset(draft, { envMode: "worktree", startFromOrigin: !startFromOrigin });
      const openThread = useNewThreadHandler();
      const projectRef = {
        environmentId: "environment-ssh",
        projectId: "project-remote",
      } as never;

      const opened = await openThread(projectRef, { envMode: "worktree", startFromOrigin });

      expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
        "remote-project",
        projectRef,
        opened!.draftId,
        expect.objectContaining({ envMode: "worktree", startFromOrigin }),
      );
    },
  );

  it("continuing seeds the thread record, the prompt, and the source model selection", async () => {
    testState.reset(draft);
    testState.threadShells = { "thread-source": { modelSelection: sourceModelSelection } };
    const opened = await useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      continueInNewThreadOptions(sourceThread),
    );

    const record = buildThreadContextRecord(sourceThread);
    expect(testState.draftStore.addThreadReference).toHaveBeenCalledWith(opened!.draftId, record);
    expect(testState.draftStore.setPrompt).toHaveBeenCalledWith(
      opened!.draftId,
      buildContinuePrompt(record),
    );
    expect(testState.draftStore.setModelSelection).toHaveBeenLastCalledWith(
      opened!.draftId,
      sourceModelSelection,
      { replaceOptions: true },
    );
  });

  it("a continuation draft is marked manual so it is not auto-moved", async () => {
    testState.reset(draft);
    const projectRef = { environmentId: "environment-ssh", projectId: "project-remote" } as never;
    const opened = await useNewThreadHandler()(
      projectRef,
      continueInNewThreadOptions(sourceThread),
    );

    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      opened!.draftId,
      expect.objectContaining({
        continuedFromThreadId: "thread-source",
        environmentSelection: "manual",
      }),
    );
  });
});

describe("useNewThreadHandler on an open reusable draft", () => {
  it("a plain New thread on a reused draft clears continuedFromThreadId", async () => {
    testState.reset({
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    });
    testState.routeDraftId = "draft-existing";
    const projectRef = { environmentId: "environment-ssh", projectId: "project-remote" } as never;
    await useNewThreadHandler()(projectRef);

    const cleared = expect.objectContaining({
      continuedFromThreadId: null,
      unblocksThreadId: null,
    });
    expect(testState.draftStore.setDraftThreadContext).toHaveBeenCalledWith(
      "draft-existing",
      cleared,
    );
    expect(testState.draftStore.setLogicalProjectDraftThreadId).toHaveBeenCalledWith(
      "remote-project",
      projectRef,
      "draft-existing",
      cleared,
    );
  });
});
