import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ProjectSyncRequest, ProjectSyncResponse } from "@t3tools/contracts";

const sync = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      { environmentId: "laptop", label: "My laptop", serverConfig: null },
      { environmentId: "server", label: "Remote server", serverConfig: null },
    ],
  }),
}));
vi.mock("./ProjectSettingsPanel", () => ({
  useSettingsProjectGroups: () => [],
  ProjectSettingsPanel: () => null,
}));
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));
vi.mock("../../hooks/useProjectSync", () => ({
  useProjectSync: (environmentId: string) => ({
    data: {
      defaultSourceHome: `/home/${environmentId}/.t3`,
      history: [],
      backups: [],
      activeBatchId: null,
      restorePending: false,
      configuration: {
        sourceHome: null,
        sourceId: null,
        enabled: false,
        hour: 3,
        timezone: "UTC",
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null,
        mappings: [],
      },
    } satisfies ProjectSyncResponse,
    error: null,
    pending: false,
    run: (request: ProjectSyncRequest) => sync.execute(environmentId, request),
  }),
}));
import { ProjectsSettings } from "./ProjectsSettings";

let view: ReactTestRenderer;
afterEach(async () => {
  await act(() => view?.unmount());
  vi.unstubAllGlobals();
  sync.execute.mockReset();
});

it("discovers sync from All machines and previews only the chosen destination", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Settings() {
    const [machineId, setMachineId] = useState<string | null>(null);
    return (
      <ProjectsSettings
        projectKey={null}
        machineId={machineId}
        onScopeChange={(_, machine) => setMachineId(machine)}
      />
    );
  }
  await act(() => {
    view = create(<Settings />);
  });
  expect(view.root.findAllByType("h3").map((heading) => heading.children.join(""))).toContain(
    "Sync from another T3 install",
  );
  expect(sync.execute).not.toHaveBeenCalled();
  await act(() => {
    view.root.findByType("select").props.onChange({ target: { value: "laptop" } });
  });
  const preview = view.root
    .findAllByType("button")
    .find((button) => button.children.includes("Preview import"));
  expect(preview).toBeDefined();
  sync.execute.mockResolvedValue({ preview: null });
  await act(() => preview!.props.onClick());
  expect(sync.execute).toHaveBeenCalledExactlyOnceWith("laptop", {
    operation: "preview",
    sourceHome: "/home/laptop/.t3",
  });
});
