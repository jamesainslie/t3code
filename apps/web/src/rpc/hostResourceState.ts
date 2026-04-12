import { Atom } from "effect/unstable/reactivity";
import { useAtomValue } from "@effect/atom-react";
import type {
  HostResourceSnapshot,
  HostResourceStreamEvent,
  MetricState,
  ProjectId,
} from "@t3tools/contracts";
import { appAtomRegistry } from "./atomRegistry";
import type { WsRpcClient } from "./wsRpcClient";

function makeStateAtom<A>(label: string, initialValue: A) {
  return Atom.make(initialValue).pipe(Atom.keepAlive, Atom.withLabel(label));
}

export const hostResourceAtom = makeStateAtom<HostResourceSnapshot | null>(
  "host-resource",
  null,
);

/** Apply a stream event to produce the latest snapshot. */
export function applyHostResourceStreamEvent(
  current: HostResourceSnapshot | null,
  event: HostResourceStreamEvent,
): HostResourceSnapshot | null {
  switch (event.type) {
    case "snapshot":
      return event.data;
    case "transition":
      return event.data; // transition events carry full snapshot too
  }
}

/** Get the worst metric state across all metrics in a snapshot. */
export function worstState(snapshot: HostResourceSnapshot): MetricState {
  const states: MetricState[] = [
    snapshot.ram.state,
    snapshot.cpu.state,
    snapshot.disk.state,
  ];
  if (snapshot.containers) states.push(snapshot.containers.state);
  if (snapshot.kubecontext) states.push(snapshot.kubecontext.state);
  if (snapshot.remote.isRoot) states.push("critical");

  if (states.includes("critical")) return "critical";
  if (states.includes("warn")) return "warn";
  return "normal";
}

/** React hook to read the current host resource snapshot. */
export function useHostResource(): HostResourceSnapshot | null {
  return useAtomValue(hostResourceAtom);
}

type HostResourceClient = Pick<WsRpcClient["hostResource"], "onResourceEvent">;

/** Start syncing host resource events from the server into the atom. Returns cleanup function. */
export function startHostResourceSync(
  client: HostResourceClient,
  projectId: ProjectId,
): () => void {
  return client.onResourceEvent(
    { projectId },
    (event: HostResourceStreamEvent) => {
      const current = appAtomRegistry.get(hostResourceAtom);
      const next = applyHostResourceStreamEvent(current, event);
      if (next) {
        appAtomRegistry.set(hostResourceAtom, next);
      }
    },
  );
}
