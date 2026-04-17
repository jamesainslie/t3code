import type { SavedRemoteEnvironment, SavedRemoteProject } from "@t3tools/contracts";

/**
 * UI state of the per-project reconnect affordance.
 *
 * - `idle-reconnect` — the saved project exists, its parent environment
 *   exists and has an `environmentId`, and the button is ready to click.
 * - `pending` — a reconnect is in flight.
 * - `parent-missing` — the project is orphaned: its parent saved environment
 *   is no longer in the registry. The button is disabled and the tooltip
 *   asks the user to re-pair the environment.
 * - `parent-no-id` — the parent environment is in the registry but has no
 *   `environmentId` (never successfully paired). The button is disabled.
 * - `project-missing` — the saved project itself was not found. Disabled.
 */
export type SavedProjectReconnectButtonState =
  | "idle-reconnect"
  | "pending"
  | "parent-missing"
  | "parent-no-id"
  | "project-missing";

export interface SavedProjectReconnectButtonModel {
  readonly state: SavedProjectReconnectButtonState;
  readonly label: string;
  readonly tooltip: string;
  readonly disabled: boolean;
}

interface ComputeInput {
  readonly savedProject: SavedRemoteProject | null;
  readonly savedEnvironment: SavedRemoteEnvironment | null;
  readonly busy: boolean;
}

/**
 * Pure computation of reconnect-button UI state.
 *
 * The component layer subscribes to the saved-project and saved-environment
 * registries and passes the relevant slices in; this function has no
 * dependency on any store and is trivially unit-testable.
 */
export function computeSavedProjectReconnectButtonModel(
  input: ComputeInput,
): SavedProjectReconnectButtonModel {
  const { savedProject, savedEnvironment, busy } = input;

  if (!savedProject) {
    return {
      state: "project-missing",
      label: "Reconnect",
      tooltip: "This saved project is no longer in the registry.",
      disabled: true,
    };
  }

  if (busy) {
    return {
      state: "pending",
      label: "Connecting…",
      tooltip: `Reconnecting ${savedProject.name}…`,
      disabled: true,
    };
  }

  if (!savedEnvironment) {
    return {
      state: "parent-missing",
      label: "Reconnect",
      tooltip:
        `Parent environment for "${savedProject.name}" is missing. ` +
        "Re-pair the environment to reconnect this project.",
      disabled: true,
    };
  }

  if (!savedEnvironment.environmentId) {
    return {
      state: "parent-no-id",
      label: "Reconnect",
      tooltip:
        `Parent environment "${savedEnvironment.label}" has no environmentId; ` +
        "re-pair it before reconnecting this project.",
      disabled: true,
    };
  }

  return {
    state: "idle-reconnect",
    label: "Reconnect",
    tooltip: `Reconnect "${savedProject.name}" on ${savedEnvironment.label}`,
    disabled: false,
  };
}
