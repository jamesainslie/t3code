import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ProjectId, type ProjectSyncResponse } from "@t3tools/contracts";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  run: vi.fn(),
  data: undefined as ProjectSyncResponse | undefined,
}));
vi.mock("../../hooks/useProjectSync", () => ({
  useProjectSync: () => ({ data: state.data, error: null, pending: false, run: state.run }),
}));
import { ProjectSyncSettings } from "./ProjectSyncSettings";

let view: ReactTestRenderer;
afterEach(async () => {
  await act(() => view?.unmount());
  vi.unstubAllGlobals();
});

it("lets a user skip and then reselect the original matched project before importing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.data = {
    configuration: {
      sourceHome: null,
      sourceId: null,
      enabled: false,
      hour: 3,
      timezone: "America/New_York",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      mappings: [],
    },
    history: [],
    backups: [],
    activeBatchId: null,
    defaultSourceHome: "/source",
    restorePending: false,
  };
  const preview = {
    sourceHome: "/source",
    sourceId: "source",
    contentHash: "hash",
    projects: [
      {
        sourceProjectId: ProjectId.make("upstream"),
        projectId: ProjectId.make("local"),
        title: "Example",
        workspaceRoot: "/repo",
        threadCount: 2,
        existing: true,
        warnings: [],
      },
    ],
  };
  state.run.mockReset().mockResolvedValue({ ...state.data, preview });
  await act(() => {
    view = create(<ProjectSyncSettings environmentId={EnvironmentId.make("test")} />);
  });
  const click = async (label: string) => {
    const button = view.root
      .findAllByType("button")
      .find((button) => button.children.includes(label));
    expect(button).toBeDefined();
    await act(async () => {
      await button!.props.onClick();
    });
  };
  await click("Preview import");
  await act(() => view.root.findByType("select").props.onChange({ target: { value: "skip" } }));
  expect(
    view.root.findAllByType("option").some((option) => option.props.value === "existing"),
  ).toBe(true);
  await act(() => view.root.findByType("select").props.onChange({ target: { value: "existing" } }));
  await click("Import and enable nightly sync");
  expect(state.run).toHaveBeenLastCalledWith({
    operation: "import",
    sourceHome: "/source",
    contentHash: "hash",
    nightly: true,
    mappings: [{ sourceProjectId: "upstream", projectId: "local" }],
  });
});
