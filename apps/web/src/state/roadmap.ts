import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@lathe/contracts";
import { createRoadmapEnvironmentAtoms } from "@lathe/client-runtime/state/roadmap";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";
import { primaryServerSettingsAtom } from "./server";

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
