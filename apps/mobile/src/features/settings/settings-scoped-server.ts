import {
  DEFAULT_SERVER_SETTINGS,
  isNullableProjectSettingsOverride,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type EnvironmentId,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
} from "@t3tools/shared/projectSettings";

import type { SettingsTarget } from "./settings-environment-filter";

/** Environment settings plus the keys a project can override without an environment value. */
export type MobileScopedSettingsPatch = ServerSettingsPatch &
  Partial<
    Pick<ProjectSettingsOverrides, Exclude<ProjectScopedServerSettingKey, keyof ServerSettings>>
  >;

// Override-only keys, such as the GitHub account, have no environment write to land in.
const PROJECT_ONLY_KEYS = new Set<string>(
  PROJECT_SCOPED_SERVER_SETTING_KEYS.filter((key) => !(key in DEFAULT_SERVER_SETTINGS)),
);

export interface ScopedMobileSettingsTarget {
  readonly environment: SettingsTarget;
  readonly projectId: ProjectId | null;
  readonly settings: ServerSettings;
  readonly sources: ReturnType<typeof resolveProjectSettings>["sources"];
}

export function resolveMobileSettingsTargets(
  environments: readonly SettingsTarget[],
  members: readonly { readonly environmentId: EnvironmentId; readonly id: ProjectId }[] | null,
): readonly ScopedMobileSettingsTarget[] {
  if (members === null) {
    return environments.map((environment) => ({
      environment,
      projectId: null,
      ...resolveProjectSettings(environment.serverConfig.settings, null),
    }));
  }
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]));
  return members.flatMap((member) => {
    const environment = byId.get(member.environmentId);
    if (!environment) return [];
    return [
      {
        environment,
        projectId: member.id,
        ...resolveProjectSettings(environment.serverConfig.settings, member.id),
      },
    ];
  });
}

export function planMobileScopedSettingsPatch(
  targets: readonly ScopedMobileSettingsTarget[],
  projectSelected: boolean,
  patch: MobileScopedSettingsPatch,
) {
  if (!projectSelected) {
    const environmentPatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => !PROJECT_ONLY_KEYS.has(key)),
    ) as ServerSettingsPatch;
    if (Object.keys(environmentPatch).length === 0) return [];
    return targets.map((target) => ({
      environmentId: target.environment.environmentId,
      patch: environmentPatch,
    }));
  }
  const keys = Object.keys(patch);
  if (
    keys.some(
      (key) => !PROJECT_SCOPED_SERVER_SETTING_KEYS.includes(key as ProjectScopedServerSettingKey),
    )
  )
    return [];
  const writes = new Map<EnvironmentId, Record<string, unknown>>();
  for (const target of targets) {
    if (
      target.projectId === null ||
      target.environment.serverConfig.environment.capabilities.projectSettingsOverrides !== true
    )
      continue;
    const current =
      target.environment.serverConfig.settings.projectSettingsOverrides[target.projectId] ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      // A picker's "Inherit" sends null; for keys whose override cannot
      // store null that means remove the override.
      if (
        value === null &&
        !isNullableProjectSettingsOverride(key as ProjectScopedServerSettingKey)
      ) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const overrides = writes.get(target.environment.environmentId) ?? {};
    overrides[target.projectId] = next;
    writes.set(target.environment.environmentId, overrides);
  }
  return [...writes].map(([environmentId, projectSettingsOverrides]) => ({
    environmentId,
    patch: { projectSettingsOverrides } as ServerSettingsPatch,
  }));
}

export function planMobileScopedSettingsClear(
  targets: readonly ScopedMobileSettingsTarget[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const writes = new Map<EnvironmentId, Record<string, unknown>>();
  for (const target of targets) {
    if (
      target.projectId === null ||
      target.environment.serverConfig.environment.capabilities.projectSettingsOverrides !== true
    )
      continue;
    const overrides = writes.get(target.environment.environmentId) ?? {};
    overrides[target.projectId] = clearProjectSettingsOverrides(
      target.environment.serverConfig.settings,
      target.projectId,
      keys,
    );
    writes.set(target.environment.environmentId, overrides);
  }
  return [...writes].map(([environmentId, projectSettingsOverrides]) => ({
    environmentId,
    patch: { projectSettingsOverrides } as ServerSettingsPatch,
  }));
}
