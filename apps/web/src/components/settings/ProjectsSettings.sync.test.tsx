import { act, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ProjectSyncRequest, ProjectSyncResponse } from "@t3tools/contracts";

const sync = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "laptop",
        label: "My laptop",
        serverConfig: null,
        connection: { phase: "connected" },
      },
      {
        environmentId: "server",
        label: "Remote server",
        serverConfig: null,
        connection: { phase: "connected" },
      },
    ],
  }),
  usePrimaryEnvironmentId: () => null,
}));
vi.mock("./useSettingsProjectGroups", () => ({ useSettingsProjectGroups: () => [] }));
vi.mock("./ProjectSettingsPanel", () => ({ ProjectSettingsPanel: () => null }));
vi.mock("./SettingsScopeNotice", () => ({
  SettingsScopeNotice: ({ children }: { children: string }) => <p>{children}</p>,
}));
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
import { SettingsScopeProvider } from "./SettingsScopeContext";
import type { SettingsScopeSearch } from "./settingsScope";

let view: ReactTestRenderer;
afterEach(async () => {
  await act(() => view?.unmount());
  vi.unstubAllGlobals();
  sync.execute.mockReset();
});

it("discovers sync from All machines and previews only the chosen destination", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Settings() {
    const [search, setSearch] = useState<SettingsScopeSearch>({});
    return (
      <SettingsScopeProvider search={search} onChange={setSearch}>
        <ProjectsSettings />
      </SettingsScopeProvider>
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
