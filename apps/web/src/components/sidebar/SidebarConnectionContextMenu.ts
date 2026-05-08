import type { ContextMenuItem } from "@t3tools/contracts";
import type { RemoteConnectionStateInput } from "./buildRemoteContextMenuItems";

export interface BuildConnectionContextMenuItemsInput {
  readonly environmentId: string;
  readonly label: string;
  readonly sshCommand: string | null;
  readonly connectionState: RemoteConnectionStateInput;
  readonly onReconnect: () => void;
  readonly onDisconnect: () => void;
  readonly onRemove: () => void;
  readonly onOpenSettings: () => void;
}

export interface BuildConnectionContextMenuItemsResult {
  readonly items: Array<ContextMenuItem<string>>;
  readonly actionHandlers: Map<string, () => void | Promise<void>>;
}

/**
 * Builds the context menu items for a sidebar connection entry.
 *
 * Returns an array of `ContextMenuItem` and a handler map keyed by item id,
 * matching the pattern established by `buildRemoteContextMenuItems`.
 */
export function buildConnectionContextMenuItems(
  input: BuildConnectionContextMenuItemsInput,
): BuildConnectionContextMenuItemsResult {
  const items: Array<ContextMenuItem<string>> = [];
  const actionHandlers = new Map<string, () => void | Promise<void>>();

  const { label, sshCommand, connectionState, onReconnect, onDisconnect, onRemove, onOpenSettings } = input;

  // Reconnect — shown when error or disconnected
  if (connectionState === "error" || connectionState === "disconnected") {
    const id = "reconnect";
    actionHandlers.set(id, onReconnect);
    items.push({ id, label: `Reconnect to ${label}` });
  }

  // Disconnect — shown when connected or connecting
  if (connectionState === "connected" || connectionState === "connecting") {
    const id = "disconnect";
    actionHandlers.set(id, onDisconnect);
    items.push({ id, label: `Disconnect from ${label}` });
  }

  // Copy SSH command — shown when sshCommand is available
  if (sshCommand != null) {
    const id = "copy-ssh-command";
    actionHandlers.set(id, () => {
      void navigator.clipboard.writeText(sshCommand);
    });
    items.push({ id, label: "Copy SSH command" });
  }

  // Separator
  items.push({ id: "sep-1", label: "", disabled: true });

  // Open in Settings
  const openSettingsId = "open-settings";
  actionHandlers.set(openSettingsId, onOpenSettings);
  items.push({ id: openSettingsId, label: "Open in Settings" });

  // Separator
  items.push({ id: "sep-2", label: "", disabled: true });

  // Remove — destructive
  const removeId = "remove";
  actionHandlers.set(removeId, onRemove);
  items.push({ id: removeId, label: "Remove", destructive: true });

  return { items, actionHandlers };
}
