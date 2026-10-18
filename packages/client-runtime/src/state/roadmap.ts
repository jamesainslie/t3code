import { WS_METHODS } from "@lathe/contracts";
import { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { applyRoadmapStreamItem, type RoadmapLiveState } from "../roadmap/roadmapTree.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Fork: the roadmap lives on one environment, the roadmap home. Clients talk
 * to the home directly, so both atoms take the home's environment id.
 */
export function createRoadmapEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    /** The home's work items, from a snapshot kept current by the deltas that follow it. */
    roadmapLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:roadmap",
      tag: WS_METHODS.roadmapSubscribe,
      transform: (stream) =>
        stream.pipe(
          Stream.scan((): RoadmapLiveState | null => null, applyRoadmapStreamItem),
          Stream.filter((state): state is RoadmapLiveState => state !== null),
          // A dropped stale delta returns the same state; reference equality skips it cheaply.
          Stream.changesWith(Object.is),
        ),
    }),
    dispatchRoadmap: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:roadmap:dispatch",
      tag: WS_METHODS.roadmapDispatch,
    }),
  };
}
