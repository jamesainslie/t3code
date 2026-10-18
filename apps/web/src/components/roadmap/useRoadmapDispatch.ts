import {
  CommandId,
  type EnvironmentId,
  isRoadmapError,
  type RoadmapCommand,
  RoadmapItemId,
} from "@lathe/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@lathe/client-runtime/state/runtime";
import { useCallback } from "react";

import { randomUUID } from "~/lib/utils";
import { roadmapEnvironment } from "~/state/roadmap";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";

export const newRoadmapCommandId = (): CommandId => CommandId.make(randomUUID());
export const newRoadmapItemId = (): RoadmapItemId => RoadmapItemId.make(randomUUID());

function failureMessage(error: unknown): string {
  if (isRoadmapError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Dispatches roadmap commands to the home one at a time, stopping at the first
 * refusal and showing its reason. Resolves true when every command applied.
 */
export function useRoadmapDispatch(home: EnvironmentId | null) {
  const dispatch = useAtomCommand(roadmapEnvironment.dispatchRoadmap, {
    label: "roadmap dispatch",
    reportFailure: false,
  });
  return useCallback(
    async (
      commands: RoadmapCommand | ReadonlyArray<RoadmapCommand>,
      failureTitle = "Could not update the roadmap",
    ): Promise<boolean> => {
      if (home === null) return false;
      const list: ReadonlyArray<RoadmapCommand> = "type" in commands ? [commands] : commands;
      for (const command of list) {
        const result = await dispatch({ environmentId: home, input: { command } });
        if (result._tag === "Success") continue;
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add({
            type: "error",
            title: failureTitle,
            description: failureMessage(squashAtomCommandFailure(result)),
          });
        }
        return false;
      }
      return true;
    },
    [dispatch, home],
  );
}

export type RoadmapDispatch = ReturnType<typeof useRoadmapDispatch>;
