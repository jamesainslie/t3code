import { WS_METHODS } from "@lathe/contracts";
import { Atom } from "effect/reactivity";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { applyRoadmapStreamItem, type RoadmapLiveState } from "../roadmap/roadmapTree.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Fork: the roadmap lives on one environment, the roadmap home. Clients talk
 * to the home directly, so the roadmap atoms take the home's environment id.
 * The link atoms take the environment being linked, except `mintRoadmapLink`,
 * which runs on the home.
 */
export function createRoadmapEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Frequent enough that the queued count and reachability stay honest while
  // Settings is open; the query only runs while something reads it.
  const roadmapLinkStatus = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:roadmap:link-status",
    tag: WS_METHODS.roadmapLinkStatus,
    refreshIntervalMs: 5_000,
  });
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
    roadmapLinkStatus,
    configureRoadmapLink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:roadmap:link-configure",
      tag: WS_METHODS.roadmapLinkConfigure,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(roadmapLinkStatus({ environmentId, input: {} }))),
    }),
    mintRoadmapLink: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:roadmap:link-mint",
      tag: WS_METHODS.roadmapLinkMint,
    }),
    /** Runs on the home, which holds the gh logins sync reads with. */
    importRoadmapIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:roadmap:import-issue",
      tag: WS_METHODS.roadmapImportIssue,
    }),
  };
}
