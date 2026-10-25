import { EnvironmentId, ProjectId, type ProjectSyncResponse } from "@lathe/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  run: vi.fn(),
  data: undefined as ProjectSyncResponse | undefined,
}));
vi.mock(import("../../hooks/useProjectSync"), async (original) => ({
  ...(await original()),
  useProjectSync: (() => ({
    data: state.data,
    error: null,
    pending: false,
    run: state.run,
  })) as never,
}));
import { ProjectSyncSettings } from "./ProjectSyncSettings";

it("lets a user skip and then reselect the original matched project before importing", async () => {
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
  await using _screen = await render(
    <ProjectSyncSettings environmentId={EnvironmentId.make("test")} />,
  );

  await page.getByRole("button", { name: "Preview import" }).click();
  const destination = page.getByRole("combobox", { name: "Destination for Example" });
  await destination.selectOptions("skip");
  await expect.element(destination).toHaveValue("skip");
  await expect
    .element(destination.getByRole("option", { name: "Use existing project" }))
    .toBeInTheDocument();
  await destination.selectOptions("existing");
  await page.getByRole("button", { name: "Import and enable nightly sync" }).click();

  expect(state.run).toHaveBeenLastCalledWith({
    operation: "import",
    sourceHome: "/source",
    contentHash: "hash",
    nightly: true,
    mappings: [{ sourceProjectId: "upstream", projectId: "local" }],
  });
});
