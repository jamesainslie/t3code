import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import type { ProjectSyncRequest, ProjectSyncResponse } from "@lathe/contracts";

import { render } from "../../../test/render";

const sync = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({
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
  })) as never,
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("./useSettingsProjectGroups"), async (original) => ({
  ...(await original()),
  useSettingsProjectGroups: () => [],
}));
vi.mock(import("./ProjectSettingsPanel"), async (original) => ({
  ...(await original()),
  ProjectSettingsPanel: (() => null) as never,
}));
vi.mock(import("./SettingsScopeNotice"), async (original) => ({
  ...(await original()),
  SettingsScopeNotice: (({ children }: { children: string }) => <p>{children}</p>) as never,
}));
vi.mock(import("../../hooks/useProjectSync"), async (original) => ({
  ...(await original()),
  useProjectSync: ((environmentId: string) => ({
    data: {
      defaultSourceHome: `/home/${environmentId}/.lathe`,
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
  })) as never,
}));
import { ProjectsSettings } from "./ProjectsSettings";
import { SettingsScopeProvider } from "./SettingsScopeContext";
import type { SettingsScopeSearch } from "./settingsScope";

function Settings() {
  const [search, setSearch] = useState<SettingsScopeSearch>({});
  return (
    <SettingsScopeProvider search={search} onChange={setSearch}>
      <ProjectsSettings />
    </SettingsScopeProvider>
  );
}

it("discovers sync from All machines and previews only the chosen destination", async () => {
  sync.execute.mockReset();
  await using _screen = await render(<Settings />);

  await expect
    .element(page.getByRole("heading", { name: "Sync from another T3 install" }))
    .toBeInTheDocument();
  expect(sync.execute).not.toHaveBeenCalled();

  await page.getByRole("combobox").selectOptions("laptop");
  sync.execute.mockResolvedValue({ preview: null });
  await page.getByRole("button", { name: "Preview import" }).click();

  expect(sync.execute).toHaveBeenCalledExactlyOnceWith("laptop", {
    operation: "preview",
    sourceHome: "/home/laptop/.lathe",
  });
});
