import { useCallback, useRef, useState } from "react";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type EnvironmentId,
  type ProjectId,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";

import { isElectron } from "../../env";
import { readEnvironmentApi } from "../../environmentApi";
import { readLocalApi } from "../../localApi";
import { isLinuxPlatform, newCommandId, newProjectId } from "../../lib/utils";
import { useSettings } from "~/hooks/useSettings";
import type { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { toastManager } from "../ui/toast";
import type { Project } from "../../types";

export interface UseAddProjectFlowParams {
  readonly projects: readonly Project[];
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  readonly focusMostRecentThreadForProject: (ref: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
  }) => void;
}

export interface AddProjectFlow {
  // state values (read-only for consumers)
  readonly addingProject: boolean;
  readonly newCwd: string;
  readonly isPickingFolder: boolean;
  readonly isAddingProject: boolean;
  readonly addProjectError: string | null;
  readonly addProjectInputRef: React.RefObject<HTMLInputElement | null>;
  readonly canAddProject: boolean;
  readonly shouldBrowseForProjectImmediately: boolean;
  readonly shouldShowProjectPathEntry: boolean;

  // setters the UI still needs
  readonly setNewCwd: React.Dispatch<React.SetStateAction<string>>;
  readonly setAddProjectError: React.Dispatch<React.SetStateAction<string | null>>;
  readonly setAddingProject: React.Dispatch<React.SetStateAction<boolean>>;

  // handlers
  readonly handleAddProject: () => void;
  readonly handlePickFolder: () => Promise<void>;
  readonly handleStartAddProject: () => void;
}

/**
 * Dependencies passed to {@link createAddProjectFromInput}. Extracted as a
 * separate type so the core state machine can be unit-tested without React.
 */
export interface AddProjectFromInputDeps {
  readonly projects: readonly Project[];
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  readonly focusMostRecentThreadForProject: (ref: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
  }) => void;
  readonly defaultThreadEnvMode: ThreadEnvMode;
  readonly shouldBrowseForProjectImmediately: boolean;
  readonly isAddingProject: boolean;
  readonly setIsAddingProject: (value: boolean) => void;
  readonly setNewCwd: (value: string) => void;
  readonly setAddProjectError: (value: string | null) => void;
  readonly setAddingProject: (value: boolean) => void;
  readonly readEnvironmentApi: typeof readEnvironmentApi;
}

/**
 * Pure(ish) factory for the add-project-from-input handler. Matches the byte
 * semantics of the original Sidebar implementation; see
 * {@link useAddProjectFlow} for the React-wrapped version.
 */
export function createAddProjectFromInput(
  deps: AddProjectFromInputDeps,
): (rawCwd: string) => Promise<void> {
  return async (rawCwd: string) => {
    const cwd = rawCwd.trim();
    if (!cwd || deps.isAddingProject) return;
    const api = deps.activeEnvironmentId
      ? deps.readEnvironmentApi(deps.activeEnvironmentId)
      : undefined;
    if (!api) return;

    deps.setIsAddingProject(true);
    const finishAddingProject = () => {
      deps.setIsAddingProject(false);
      deps.setNewCwd("");
      deps.setAddProjectError(null);
      deps.setAddingProject(false);
    };

    const existing = deps.projects.find((project) => project.cwd === cwd);
    if (existing) {
      deps.focusMostRecentThreadForProject({
        environmentId: existing.environmentId,
        projectId: existing.id,
      });
      finishAddingProject();
      return;
    }

    const projectId = newProjectId();
    const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
    try {
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title,
        workspaceRoot: cwd,
        defaultModelSelection: {
          provider: "codex",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
        },
        createdAt: new Date().toISOString(),
      });
      if (deps.activeEnvironmentId !== null) {
        await deps
          .handleNewThread(scopeProjectRef(deps.activeEnvironmentId, projectId), {
            envMode: deps.defaultThreadEnvMode,
          })
          .catch(() => undefined);
      }
    } catch (error) {
      const description =
        error instanceof Error ? error.message : "An error occurred while adding the project.";
      deps.setIsAddingProject(false);
      if (deps.shouldBrowseForProjectImmediately) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description,
        });
      } else {
        deps.setAddProjectError(description);
      }
      return;
    }
    finishAddingProject();
  };
}

/**
 * Computes platform-derived flags used by the add-project UI. Exposed for
 * tests so we can exercise the Electron/Linux branches without touching
 * {@link globalThis.navigator}.
 */
export function deriveAddProjectPlatformFlags(input: {
  readonly isElectron: boolean;
  readonly platform: string;
  readonly addingProject: boolean;
}): {
  readonly shouldBrowseForProjectImmediately: boolean;
  readonly shouldShowProjectPathEntry: boolean;
} {
  const isLinuxDesktop = input.isElectron && isLinuxPlatform(input.platform);
  const shouldBrowseForProjectImmediately = input.isElectron && !isLinuxDesktop;
  const shouldShowProjectPathEntry = input.addingProject && !shouldBrowseForProjectImmediately;
  return { shouldBrowseForProjectImmediately, shouldShowProjectPathEntry };
}

/**
 * Dependencies for {@link createHandleStartAddProject}. Separates the handler
 * logic from React state so it can be tested without rendering.
 */
export interface HandleStartAddProjectDeps {
  readonly shouldBrowseForProjectImmediately: boolean;
  readonly setAddProjectError: (value: string | null) => void;
  readonly setAddingProject: (updater: (prev: boolean) => boolean) => void;
  readonly handlePickFolder: () => Promise<void>;
}

export function createHandleStartAddProject(deps: HandleStartAddProjectDeps): () => void {
  return () => {
    deps.setAddProjectError(null);
    if (deps.shouldBrowseForProjectImmediately) {
      void deps.handlePickFolder();
      return;
    }
    deps.setAddingProject((prev) => !prev);
  };
}

/**
 * Dependencies for {@link createHandlePickFolder}. `readLocalApi` is passed in
 * to make the dialog picker mockable in tests.
 */
export interface HandlePickFolderDeps {
  readonly isPickingFolder: boolean;
  readonly setIsPickingFolder: (value: boolean) => void;
  readonly shouldBrowseForProjectImmediately: boolean;
  readonly addProjectFromInput: (cwd: string) => Promise<void>;
  readonly addProjectInputRef: React.RefObject<HTMLInputElement | null>;
  readonly readLocalApi: typeof readLocalApi;
}

export function createHandlePickFolder(deps: HandlePickFolderDeps): () => Promise<void> {
  return async () => {
    const api = deps.readLocalApi();
    if (!api || deps.isPickingFolder) return;
    deps.setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await deps.addProjectFromInput(pickedPath);
    } else if (!deps.shouldBrowseForProjectImmediately) {
      deps.addProjectInputRef.current?.focus();
    }
    deps.setIsPickingFolder(false);
  };
}

export function useAddProjectFlow(params: UseAddProjectFlowParams): AddProjectFlow {
  const { projects, activeEnvironmentId, handleNewThread, focusMostRecentThreadForProject } =
    params;

  const defaultThreadEnvMode = useSettings<ThreadEnvMode>(
    (settings) => settings.defaultThreadEnvMode,
  );

  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);

  const platform = navigator.platform;
  const { shouldBrowseForProjectImmediately, shouldShowProjectPathEntry } =
    deriveAddProjectPlatformFlags({ isElectron, platform, addingProject });

  const addProjectFromInput = useCallback(
    async (rawCwd: string) => {
      const run = createAddProjectFromInput({
        projects,
        activeEnvironmentId,
        handleNewThread,
        focusMostRecentThreadForProject,
        defaultThreadEnvMode,
        shouldBrowseForProjectImmediately,
        isAddingProject,
        setIsAddingProject,
        setNewCwd,
        setAddProjectError,
        setAddingProject,
        readEnvironmentApi,
      });
      await run(rawCwd);
    },
    [
      focusMostRecentThreadForProject,
      activeEnvironmentId,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
      defaultThreadEnvMode,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromInput(newCwd);
  };

  const canAddProject = newCwd.trim().length > 0 && !isAddingProject;

  const handlePickFolder = createHandlePickFolder({
    isPickingFolder,
    setIsPickingFolder,
    shouldBrowseForProjectImmediately,
    addProjectFromInput,
    addProjectInputRef,
    readLocalApi,
  });

  const handleStartAddProject = createHandleStartAddProject({
    shouldBrowseForProjectImmediately,
    setAddProjectError,
    setAddingProject,
    handlePickFolder,
  });

  return {
    addingProject,
    newCwd,
    isPickingFolder,
    isAddingProject,
    addProjectError,
    addProjectInputRef,
    canAddProject,
    shouldBrowseForProjectImmediately,
    shouldShowProjectPathEntry,
    setNewCwd,
    setAddProjectError,
    setAddingProject,
    handleAddProject,
    handlePickFolder,
    handleStartAddProject,
  };
}
