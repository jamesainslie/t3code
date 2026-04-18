import type { ContextMenuItem, EnvironmentId, RemoteIdentityKey } from "@t3tools/contracts";
import {
  connectSavedEnvironment,
  disconnectSavedEnvironment,
  removeSavedEnvironment,
} from "../../environments/runtime";
import { toastManager } from "../ui/toast";

export type RemoteConnectionStateInput =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | null;

export interface BuildRemoteContextMenuItemsInput {
  readonly project: {
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly remoteEnvironmentLabels: readonly string[];
  };
  readonly remoteIdentityKey: RemoteIdentityKey | null;
  readonly remoteConnectionState: RemoteConnectionStateInput;
  readonly api: {
    readonly dialogs: {
      readonly confirm: (message: string) => Promise<boolean>;
    };
  };
}

export interface BuildRemoteContextMenuItemsResult {
  readonly items: Array<ContextMenuItem<string>>;
  readonly actionHandlers: Map<string, () => void | Promise<void>>;
}

/**
 * Builds the remote-specific context menu items (Reconnect / Disconnect /
 * Remove remote) for a sidebar project row and returns their action handler
 * closures. When `remoteIdentityKey` is null (i.e. the project is not a
 * remote project) the function returns empty output so callers don't need
 * to guard at the call site.
 *
 * Byte-equivalent to the inline block previously embedded in
 * Sidebar.tsx::handleProjectButtonContextMenu. Extracted to reduce
 * fork-vs-upstream merge-conflict surface.
 */
export function buildRemoteContextMenuItems(
  input: BuildRemoteContextMenuItemsInput,
): BuildRemoteContextMenuItemsResult {
  const items: Array<ContextMenuItem<string>> = [];
  const actionHandlers = new Map<string, () => void | Promise<void>>();

  const { project, remoteIdentityKey, remoteConnectionState, api } = input;
  if (remoteIdentityKey == null) {
    return { items, actionHandlers };
  }

  const connState = remoteConnectionState;
  const envLabel = project.remoteEnvironmentLabels[0] ?? null;

  if (connState === "disconnected" || connState === "error") {
    const id = "reconnect";
    actionHandlers.set(id, () => {
      void connectSavedEnvironment(remoteIdentityKey).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to reconnect",
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      });
    });
    items.push({
      id,
      label: envLabel ? `Reconnect to ${envLabel}` : "Reconnect",
    });
  }

  if (connState === "connected" || connState === "connecting") {
    const id = "disconnect";
    actionHandlers.set(id, () => {
      void disconnectSavedEnvironment(project.environmentId).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Failed to disconnect",
          description: error instanceof Error ? error.message : "Unknown error.",
        });
      });
    });
    items.push({
      id,
      label: envLabel ? `Disconnect from ${envLabel}` : "Disconnect",
    });
  }

  const removeRemoteId = "remove-remote";
  actionHandlers.set(removeRemoteId, async () => {
    const confirmed = await api.dialogs.confirm(
      `Remove remote connection for "${project.name}"? This will not delete the project data on the remote host.`,
    );
    if (!confirmed) return;
    void removeSavedEnvironment(project.environmentId).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Failed to remove remote",
        description: error instanceof Error ? error.message : "Unknown error.",
      });
    });
  });
  items.push({ id: removeRemoteId, label: "Remove remote", destructive: true });

  return { items, actionHandlers };
}
