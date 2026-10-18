import type { EnvironmentId } from "@lathe/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@lathe/client-runtime/state/runtime";
import { useCallback } from "react";

import { roadmapEnvironment } from "~/state/roadmap";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";

const linkFailure = (title: string, error: unknown) =>
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });

/**
 * Links an environment to the roadmap home: mints a one-time link on the home,
 * then hands it to the environment, which spends it at `homeUrl`. The client
 * is connected to both, so no credential is ever copied by hand. Resolves true
 * once linked.
 */
export function useLinkToRoadmapHome() {
  const mint = useAtomCommand(roadmapEnvironment.mintRoadmapLink, {
    label: "roadmap link",
    reportFailure: false,
  });
  const configure = useAtomCommand(roadmapEnvironment.configureRoadmapLink, {
    label: "roadmap link",
    reportFailure: false,
  });
  return useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly home: EnvironmentId;
      readonly homeUrl: string;
    }): Promise<boolean> => {
      const minted = await mint({
        environmentId: input.home,
        input: {
          environmentId: input.environmentId,
          label: `Roadmap link from ${input.environmentLabel}`,
        },
      });
      if (minted._tag !== "Success") {
        if (!isAtomCommandInterrupted(minted)) {
          linkFailure("Could not create a roadmap link", squashAtomCommandFailure(minted));
        }
        return false;
      }
      const linked = await configure({
        environmentId: input.environmentId,
        input: { link: { homeUrl: input.homeUrl, credential: minted.value.credential } },
      });
      if (linked._tag !== "Success") {
        if (!isAtomCommandInterrupted(linked)) {
          linkFailure("Could not link to the roadmap home", squashAtomCommandFailure(linked));
        }
        return false;
      }
      return true;
    },
    [configure, mint],
  );
}

/** Forgets an environment's link; its agents lose the roadmap until it is linked again. */
export function useUnlinkFromRoadmapHome() {
  const configure = useAtomCommand(roadmapEnvironment.configureRoadmapLink, "roadmap unlink");
  return useCallback(
    async (environmentId: EnvironmentId): Promise<boolean> =>
      (await configure({ environmentId, input: { link: null } }))._tag === "Success",
    [configure],
  );
}
