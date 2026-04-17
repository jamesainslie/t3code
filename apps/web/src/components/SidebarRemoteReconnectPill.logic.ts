import type { EnvironmentId, SavedRemoteEnvironment } from "@t3tools/contracts";
import type { SavedEnvironmentRuntimeState } from "../environments/runtime";

/**
 * Visual/interaction state of the aggregate remote-reconnect pill shown in the
 * sidebar header. Derived solely from the saved-environment registry and the
 * per-environment runtime state — no component-local state is involved, which
 * keeps the rendering path pure and trivially testable.
 */
export type RemotePillState = "hidden" | "connected" | "connecting" | "reconnect" | "error";

export interface RemotePillModel {
  readonly state: RemotePillState;
  readonly label: string;
  readonly tooltip: string;
  /** Environment ids that are in a disconnected/error state and should be reconnected on click. */
  readonly reconnectTargets: ReadonlyArray<EnvironmentId>;
  readonly remoteCount: number;
}

type KnownRecord = SavedRemoteEnvironment & { environmentId: EnvironmentId };

function isKnownRecord(record: SavedRemoteEnvironment): record is KnownRecord {
  return record.environmentId !== null;
}

/**
 * Computes the pill model from the current registry + runtime snapshot.
 *
 * Semantics:
 *   - No saved remote environments → `hidden`
 *   - Any saved remote in `connecting` → `connecting`
 *   - Any saved remote in `error` → `error` (click reconnects those)
 *   - Any saved remote in `disconnected` → `reconnect` (click reconnects those)
 *   - All saved remotes are `connected` → `connected`
 *
 * Label includes the environment label when exactly one remote is configured,
 * otherwise shows an aggregate count.
 */
export function computeRemotePillModel(input: {
  readonly records: ReadonlyArray<SavedRemoteEnvironment>;
  readonly runtimeById: Readonly<Record<EnvironmentId, SavedEnvironmentRuntimeState>>;
}): RemotePillModel {
  const remotes: ReadonlyArray<KnownRecord> = input.records.filter(isKnownRecord);

  if (remotes.length === 0) {
    return {
      state: "hidden",
      label: "",
      tooltip: "",
      reconnectTargets: [],
      remoteCount: 0,
    };
  }

  const stateOf = (environmentId: EnvironmentId) =>
    input.runtimeById[environmentId]?.connectionState ?? "disconnected";

  const errorTargets: EnvironmentId[] = [];
  const disconnectedTargets: EnvironmentId[] = [];
  let connectingCount = 0;
  let connectedCount = 0;

  for (const record of remotes) {
    const connectionState = stateOf(record.environmentId);
    if (connectionState === "error") {
      errorTargets.push(record.environmentId);
    } else if (connectionState === "disconnected") {
      disconnectedTargets.push(record.environmentId);
    } else if (connectionState === "connecting") {
      connectingCount += 1;
    } else if (connectionState === "connected") {
      connectedCount += 1;
    }
  }

  const single = remotes.length === 1 ? remotes[0]! : null;

  if (errorTargets.length > 0) {
    return {
      state: "error",
      label: single ? `Reconnect ${single.label}` : `Reconnect (${errorTargets.length})`,
      tooltip: single
        ? `${single.label}: connection error — click to retry`
        : `${errorTargets.length} remote environment${errorTargets.length === 1 ? "" : "s"} in error state`,
      reconnectTargets: errorTargets,
      remoteCount: remotes.length,
    };
  }

  if (disconnectedTargets.length > 0) {
    return {
      state: "reconnect",
      label: single ? `Reconnect ${single.label}` : `Reconnect (${disconnectedTargets.length})`,
      tooltip: single
        ? `${single.label}: disconnected — click to reconnect`
        : `${disconnectedTargets.length} of ${remotes.length} remote environments disconnected`,
      reconnectTargets: disconnectedTargets,
      remoteCount: remotes.length,
    };
  }

  if (connectingCount > 0) {
    return {
      state: "connecting",
      label: single ? single.label : `Connecting (${connectingCount})`,
      tooltip: "Connecting to remote environment…",
      reconnectTargets: [],
      remoteCount: remotes.length,
    };
  }

  return {
    state: "connected",
    label: single ? single.label : `Connected (${connectedCount})`,
    tooltip: single
      ? `${single.label}: connected`
      : `${connectedCount} remote environment${connectedCount === 1 ? "" : "s"} connected`,
    reconnectTargets: [],
    remoteCount: remotes.length,
  };
}
