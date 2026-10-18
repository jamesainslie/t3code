import { useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type RoadmapArea,
  type RoadmapAreaSettingsPatch,
  type RoadmapAreasSettings,
} from "@lathe/contracts";
import { createRoadmapEnvironmentAtoms } from "@lathe/client-runtime/state/roadmap";
import { useCallback } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";
import { primaryServerSettingsAtom, serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

/** Fork: roadmap. `roadmapLive` and `dispatchRoadmap` take the roadmap home's environment id. */
export const roadmapEnvironment = createRoadmapEnvironmentAtoms(connectionAtomRuntime);

/**
 * The environment that owns the roadmap: the primary environment's
 * `roadmap.homeEnvironmentId`, else the primary environment itself.
 */
export function useRoadmapHome(): EnvironmentId | null {
  const settings = useAtomValue(primaryServerSettingsAtom);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return settings.roadmap.homeEnvironmentId ?? primaryEnvironmentId;
}

/** The home's live roadmap; `data` is null while loading or when `home` is null. */
export function useRoadmapLive(home: EnvironmentId | null) {
  return useEnvironmentQuery(
    home === null ? null : roadmapEnvironment.roadmapLive({ environmentId: home, input: {} }),
  );
}

/** Whether the home serves the roadmap; every roadmap entry point is gated on it. */
export function useRoadmapSupported(home: EnvironmentId | null): boolean {
  const config = useAtomValue(serverEnvironment.configValueAtom(home));
  return config?.environment.capabilities.roadmap === true;
}

/**
 * Each area's unit and calendar, read from the home's settings because the
 * home computes for every client; defaults until its config arrives.
 */
export function useRoadmapAreaSettings(home: EnvironmentId | null): RoadmapAreasSettings {
  const config = useAtomValue(serverEnvironment.configValueAtom(home));
  return config?.settings.roadmap.areas ?? DEFAULT_SERVER_SETTINGS.roadmap.areas;
}

/**
 * Writes one area's settings on the home, not through the settings scope,
 * which only reaches the environment Settings has selected. Resolves true
 * once saved; a failure is reported by the command.
 */
export function useUpdateRoadmapAreaSettings(home: EnvironmentId | null) {
  const update = useAtomCommand(serverEnvironment.updateSettings, "roadmap area settings");
  return useCallback(
    async (area: RoadmapArea, patch: RoadmapAreaSettingsPatch): Promise<boolean> => {
      if (home === null) return false;
      const result = await update({
        environmentId: home,
        input: {
          patch: {
            roadmap: { areas: area === "work" ? { work: patch } : { personal: patch } },
          },
        },
      });
      return result._tag === "Success";
    },
    [home, update],
  );
}

/** Whether the environment can link to a roadmap home, and mint links as one. */
export function useRoadmapLinkSupported(environmentId: EnvironmentId | null): boolean {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return config?.environment.capabilities.roadmapLink === true;
}

/** `useRoadmapLinkSupported` for event handlers. */
export function readRoadmapLinkSupported(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId))?.environment.capabilities
      .roadmapLink === true
  );
}

/** An environment's link to the roadmap home; `data` is null while loading or for null. */
export function useRoadmapLinkStatus(environmentId: EnvironmentId | null) {
  return useEnvironmentQuery(
    environmentId === null
      ? null
      : roadmapEnvironment.roadmapLinkStatus({ environmentId, input: {} }),
  );
}
