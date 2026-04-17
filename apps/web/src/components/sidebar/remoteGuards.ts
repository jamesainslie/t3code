import type { EnvironmentId, RemoteIdentityKey } from "@t3tools/contracts";
import {
  connectSavedEnvironment,
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../../environments/runtime";
import { toastManager } from "../ui/toast";

/**
 * Guard that ensures a saved remote environment is connected before navigating
 * to one of its threads. Returns `true` when the environment is already
 * connected (or has no registered identity), attempts to reconnect if the
 * runtime state is `disconnected` or `error`, and surfaces a toast on failure.
 *
 * Byte-equivalent to the useCallback bodies that previously lived inline in
 * Sidebar.tsx. Extracted to reduce fork-vs-upstream merge-conflict surface.
 */
export async function ensureRemoteConnected(environmentId: EnvironmentId): Promise<boolean> {
  const runtimeState =
    useSavedEnvironmentRuntimeStore.getState().byId[environmentId]?.connectionState ?? null;
  if (runtimeState !== "disconnected" && runtimeState !== "error") return true;
  const identityKey = useSavedEnvironmentRegistryStore.getState().identityKeyByEnvironmentId[
    environmentId
  ] as RemoteIdentityKey | undefined;
  if (!identityKey) return true;
  try {
    await connectSavedEnvironment(identityKey);
    return true;
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Failed to reconnect",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
    return false;
  }
}
