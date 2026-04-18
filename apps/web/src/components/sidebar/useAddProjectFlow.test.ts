import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, type ThreadEnvMode } from "@t3tools/contracts";

vi.mock("../ui/toast", () => ({
  toastManager: {
    add: vi.fn(),
  },
}));

import { toastManager } from "../ui/toast";
import {
  createAddProjectFromInput,
  createHandlePickFolder,
  createHandleStartAddProject,
  deriveAddProjectPlatformFlags,
} from "./useAddProjectFlow";

const envA = "env-a" as unknown as EnvironmentId;
const existingProjectId = "proj-existing" as unknown as ProjectId;

function makeProject(
  overrides: Partial<{ id: ProjectId; cwd: string; environmentId: EnvironmentId }>,
) {
  return {
    id: (overrides.id ?? existingProjectId) as ProjectId,
    environmentId: overrides.environmentId ?? envA,
    name: "Existing",
    cwd: overrides.cwd ?? "/tmp/existing",
    defaultModelSelection: null,
    scripts: [],
  };
}

function buildMutableState() {
  const state = {
    isAddingProject: false,
    addingProject: false,
    newCwd: "",
    addProjectError: null as string | null,
    isPickingFolder: false,
  };
  return {
    state,
    setIsAddingProject: (v: boolean) => {
      state.isAddingProject = v;
    },
    setAddingProject: (v: boolean) => {
      state.addingProject = v;
    },
    setNewCwd: (v: string) => {
      state.newCwd = v;
    },
    setAddProjectError: (v: string | null) => {
      state.addProjectError = v;
    },
    setIsPickingFolder: (v: boolean) => {
      state.isPickingFolder = v;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deriveAddProjectPlatformFlags", () => {
  it("Linux electron keeps inline entry (no immediate browse)", () => {
    const flags = deriveAddProjectPlatformFlags({
      isElectron: true,
      platform: "Linux x86_64",
      addingProject: true,
    });
    expect(flags.shouldBrowseForProjectImmediately).toBe(false);
    expect(flags.shouldShowProjectPathEntry).toBe(true);
  });

  it("macOS electron triggers immediate browse and hides entry", () => {
    const flags = deriveAddProjectPlatformFlags({
      isElectron: true,
      platform: "MacIntel",
      addingProject: true,
    });
    expect(flags.shouldBrowseForProjectImmediately).toBe(true);
    expect(flags.shouldShowProjectPathEntry).toBe(false);
  });

  it("web (non-electron) uses inline entry", () => {
    const flags = deriveAddProjectPlatformFlags({
      isElectron: false,
      platform: "MacIntel",
      addingProject: true,
    });
    expect(flags.shouldBrowseForProjectImmediately).toBe(false);
    expect(flags.shouldShowProjectPathEntry).toBe(true);
  });
});

describe("createHandleStartAddProject", () => {
  it("toggles addingProject when not in electron-browse-immediate mode", () => {
    const s = buildMutableState();
    const handlePickFolder = vi.fn().mockResolvedValue(undefined);
    const handler = createHandleStartAddProject({
      shouldBrowseForProjectImmediately: false,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: (updater) => {
        s.state.addingProject = updater(s.state.addingProject);
      },
      handlePickFolder,
    });

    s.state.addProjectError = "stale";
    handler();
    expect(s.state.addProjectError).toBeNull();
    expect(s.state.addingProject).toBe(true);
    expect(handlePickFolder).not.toHaveBeenCalled();

    handler();
    expect(s.state.addingProject).toBe(false);
  });

  it("calls handlePickFolder when in electron-browse-immediate mode", () => {
    const s = buildMutableState();
    const handlePickFolder = vi.fn().mockResolvedValue(undefined);
    const handler = createHandleStartAddProject({
      shouldBrowseForProjectImmediately: true,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: (updater) => {
        s.state.addingProject = updater(s.state.addingProject);
      },
      handlePickFolder,
    });

    handler();
    expect(handlePickFolder).toHaveBeenCalledTimes(1);
    // Browse-immediate mode does not toggle the inline entry flag.
    expect(s.state.addingProject).toBe(false);
  });
});

describe("createAddProjectFromInput", () => {
  it("focuses existing project when cwd matches and does not dispatch", async () => {
    const s = buildMutableState();
    const focusMostRecentThreadForProject = vi.fn();
    const handleNewThread = vi.fn();
    const dispatchCommand = vi.fn();
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [makeProject({ cwd: "/tmp/existing", id: existingProjectId })] as never,
      activeEnvironmentId: envA,
      handleNewThread: handleNewThread as never,
      focusMostRecentThreadForProject,
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
    });

    await run("/tmp/existing");

    expect(focusMostRecentThreadForProject).toHaveBeenCalledWith({
      environmentId: envA,
      projectId: existingProjectId,
    });
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(handleNewThread).not.toHaveBeenCalled();
    expect(s.state.isAddingProject).toBe(false);
    expect(s.state.addingProject).toBe(false);
    expect(s.state.newCwd).toBe("");
    expect(s.state.addProjectError).toBeNull();
  });

  it("dispatches project.create for a new cwd and then creates default thread", async () => {
    const s = buildMutableState();
    const focusMostRecentThreadForProject = vi.fn();
    const handleNewThread = vi.fn().mockResolvedValue(undefined);
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: handleNewThread as never,
      focusMostRecentThreadForProject,
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
    });

    await run("  /tmp/newproject  ");

    expect(dispatchCommand).toHaveBeenCalledTimes(1);
    const dispatched = dispatchCommand.mock.calls[0]![0] as {
      type: string;
      workspaceRoot: string;
      title: string;
      defaultModelSelection: { provider: string };
    };
    expect(dispatched.type).toBe("project.create");
    expect(dispatched.workspaceRoot).toBe("/tmp/newproject");
    expect(dispatched.title).toBe("newproject");
    expect(dispatched.defaultModelSelection.provider).toBe("codex");

    expect(handleNewThread).toHaveBeenCalledTimes(1);
    expect(focusMostRecentThreadForProject).not.toHaveBeenCalled();
    expect(s.state.isAddingProject).toBe(false);
    expect(s.state.newCwd).toBe("");
    expect(s.state.addingProject).toBe(false);
  });

  it("calls onProjectDispatched after dispatch and before handleNewThread", async () => {
    const s = buildMutableState();
    const callOrder: string[] = [];
    const dispatchCommand = vi.fn().mockImplementation(async () => {
      callOrder.push("dispatchCommand");
    });
    const onProjectDispatched = vi.fn().mockImplementation(() => {
      callOrder.push("onProjectDispatched");
    });
    const handleNewThread = vi.fn().mockImplementation(async () => {
      callOrder.push("handleNewThread");
    });
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: handleNewThread as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
      onProjectDispatched,
    });

    await run("/tmp/myproject");

    // Must be called exactly once with the project metadata
    expect(onProjectDispatched).toHaveBeenCalledTimes(1);
    const arg = onProjectDispatched.mock.calls[0]![0] as {
      environmentId: EnvironmentId;
      projectId: ProjectId;
      title: string;
      workspaceRoot: string;
      createdAt: string;
    };
    expect(arg.environmentId).toBe(envA);
    expect(arg.title).toBe("myproject");
    expect(arg.workspaceRoot).toBe("/tmp/myproject");
    expect(typeof arg.projectId).toBe("string");
    expect(typeof arg.createdAt).toBe("string");

    // Critical ordering: dispatch → optimistic write → navigate
    expect(callOrder).toEqual(["dispatchCommand", "onProjectDispatched", "handleNewThread"]);
  });

  it("does not call onProjectDispatched when dispatch fails", async () => {
    const s = buildMutableState();
    const dispatchCommand = vi.fn().mockRejectedValue(new Error("network"));
    const onProjectDispatched = vi.fn();
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: vi.fn() as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
      onProjectDispatched,
    });

    await run("/tmp/fail");

    expect(onProjectDispatched).not.toHaveBeenCalled();
    expect(s.state.addProjectError).toBe("network");
  });

  it("sets addProjectError when dispatch throws and not in browse-immediate mode", async () => {
    const s = buildMutableState();
    const dispatchCommand = vi.fn().mockRejectedValue(new Error("boom"));
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: vi.fn() as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
    });

    await run("/tmp/new");

    expect(s.state.addProjectError).toBe("boom");
    expect(s.state.isAddingProject).toBe(false);
    // Inline mode keeps addingProject true so the error surfaces in the path entry.
    expect(toastManager.add).not.toHaveBeenCalled();
  });

  it("shows toast instead of inline error when in browse-immediate mode", async () => {
    const s = buildMutableState();
    const dispatchCommand = vi.fn().mockRejectedValue(new Error("kaput"));
    const readEnvironmentApi = vi.fn(() => ({
      orchestration: { dispatchCommand },
    })) as unknown as typeof import("../../environmentApi").readEnvironmentApi;

    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: vi.fn() as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: true,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi,
    });

    await run("/tmp/new");

    expect(toastManager.add).toHaveBeenCalledTimes(1);
    expect(s.state.addProjectError).toBeNull();
    expect(s.state.isAddingProject).toBe(false);
  });

  it("no-ops on empty trimmed cwd", async () => {
    const s = buildMutableState();
    const readEnvironmentApi = vi.fn();
    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: vi.fn() as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: s.state.isAddingProject,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi: readEnvironmentApi as never,
    });

    await run("   ");
    expect(readEnvironmentApi).not.toHaveBeenCalled();
    expect(s.state.isAddingProject).toBe(false);
  });

  it("no-ops when isAddingProject is already true", async () => {
    const s = buildMutableState();
    s.state.isAddingProject = true;
    const readEnvironmentApi = vi.fn();
    const run = createAddProjectFromInput({
      projects: [] as never,
      activeEnvironmentId: envA,
      handleNewThread: vi.fn() as never,
      focusMostRecentThreadForProject: vi.fn(),
      defaultThreadEnvMode: "local" as ThreadEnvMode,
      shouldBrowseForProjectImmediately: false,
      isAddingProject: true,
      setIsAddingProject: s.setIsAddingProject,
      setNewCwd: s.setNewCwd,
      setAddProjectError: s.setAddProjectError,
      setAddingProject: s.setAddingProject,
      readEnvironmentApi: readEnvironmentApi as never,
    });

    await run("/tmp/new");
    expect(readEnvironmentApi).not.toHaveBeenCalled();
  });
});

describe("createHandlePickFolder", () => {
  it("no-ops when local API is unavailable", async () => {
    const s = buildMutableState();
    const addProjectFromInput = vi.fn().mockResolvedValue(undefined);
    const handler = createHandlePickFolder({
      isPickingFolder: s.state.isPickingFolder,
      setIsPickingFolder: s.setIsPickingFolder,
      shouldBrowseForProjectImmediately: true,
      addProjectFromInput,
      addProjectInputRef: { current: null },
      readLocalApi: (() => undefined) as never,
    });
    await handler();
    expect(addProjectFromInput).not.toHaveBeenCalled();
    expect(s.state.isPickingFolder).toBe(false);
  });

  it("calls addProjectFromInput with the picked path", async () => {
    const s = buildMutableState();
    const addProjectFromInput = vi.fn().mockResolvedValue(undefined);
    const pickFolder = vi.fn().mockResolvedValue("/tmp/picked");
    const readLocalApi = (() => ({ dialogs: { pickFolder } })) as never;
    const handler = createHandlePickFolder({
      isPickingFolder: s.state.isPickingFolder,
      setIsPickingFolder: s.setIsPickingFolder,
      shouldBrowseForProjectImmediately: true,
      addProjectFromInput,
      addProjectInputRef: { current: null },
      readLocalApi,
    });
    await handler();
    expect(addProjectFromInput).toHaveBeenCalledWith("/tmp/picked");
    expect(s.state.isPickingFolder).toBe(false);
  });

  it("focuses the input when picker is cancelled and not in browse-immediate mode", async () => {
    const s = buildMutableState();
    const focus = vi.fn();
    const addProjectFromInput = vi.fn().mockResolvedValue(undefined);
    const pickFolder = vi.fn().mockResolvedValue(null);
    const readLocalApi = (() => ({ dialogs: { pickFolder } })) as never;
    const handler = createHandlePickFolder({
      isPickingFolder: s.state.isPickingFolder,
      setIsPickingFolder: s.setIsPickingFolder,
      shouldBrowseForProjectImmediately: false,
      addProjectFromInput,
      addProjectInputRef: { current: { focus } as unknown as HTMLInputElement },
      readLocalApi,
    });
    await handler();
    expect(addProjectFromInput).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
});
