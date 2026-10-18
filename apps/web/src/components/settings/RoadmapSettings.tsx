import { EnvironmentId } from "@lathe/contracts";

import { requestConfirmDialog } from "~/confirmDialog";
import { useEnvironments } from "~/state/environments";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const THIS_ENVIRONMENT = "this";

/** Fork: roadmap. Which environment owns the roadmap; per-area settings arrive in phase 2. */
export function RoadmapSettingsPanel() {
  const { scope, connectedEnvironments, targets } = useSettingsScope();
  const { environments } = useEnvironments();
  const settings = useScopedSettings();
  const mixed = useScopedSettingsMixed(["roadmap"]);
  const updateSettings = useUpdateScopedSettings();

  if (scope.kind === "project" || scope.kind === "checkout") {
    return (
      <SettingsScopeNotice target="all">
        The roadmap home is set per environment. Choose an environment to change it.
      </SettingsScopeNotice>
    );
  }
  const eligibleEnvironmentIds = connectedEnvironments
    .filter((environment) => environment.serverConfig?.environment.capabilities.roadmap === true)
    .map((environment) => environment.environmentId);
  if (eligibleEnvironmentIds.length < connectedEnvironments.length) {
    return (
      <SettingsScopeNotice target="environment" eligibleEnvironmentIds={eligibleEnvironmentIds}>
        Update the selected environments to use the roadmap, or choose one that supports it.
      </SettingsScopeNotice>
    );
  }

  // With one target, choosing that target is the same as "This environment".
  const ownId = targets.length === 1 ? targets[0]!.environmentId : null;
  const options = environments.filter((environment) => environment.environmentId !== ownId);
  const labels: Record<string, string> = {
    [THIS_ENVIRONMENT]: "This environment",
    ...Object.fromEntries(
      options.map((environment) => [environment.environmentId, environment.label]),
    ),
  };
  const homeId = settings.roadmap.homeEnvironmentId;
  const value = mixed ? null : homeId === null || homeId === ownId ? THIS_ENVIRONMENT : homeId;

  const choose = async (next: string) => {
    const homeEnvironmentId = next === THIS_ENVIRONMENT ? null : EnvironmentId.make(next);
    if (!mixed && homeEnvironmentId === homeId) return;
    const confirmed = await requestConfirmDialog(
      "Change the roadmap home?\nThe roadmap does not move with it. Work items stay where they are, and the new home shows its own roadmap. Moving a roadmap between environments arrives in a later release.",
    );
    if (confirmed !== true) return;
    updateSettings({ roadmap: { homeEnvironmentId } });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Roadmap">
        <SettingsRow
          serverScoped
          settingKeys={["roadmap"]}
          {...searchableSetting("roadmap-home")}
          description="The environment whose database holds the roadmap. Every client reads and changes work items there."
          control={
            <Select
              value={value}
              items={labels}
              onValueChange={(next) => {
                if (next !== null) void choose(next);
              }}
            >
              <SelectTrigger size="sm" aria-label="Roadmap home">
                <SelectValue>
                  {(current: string | null) =>
                    current === null ? "Mixed" : (labels[current] ?? "Unknown environment")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value={THIS_ENVIRONMENT}>This environment</SelectItem>
                {options.map((environment) => (
                  <SelectItem key={environment.environmentId} value={environment.environmentId}>
                    {environment.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
