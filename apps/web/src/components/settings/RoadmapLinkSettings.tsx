import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@lathe/contracts";
import { useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { roadmapEnvironment, useRoadmapLinkStatus, useRoadmapLinkSupported } from "~/state/roadmap";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { describeRoadmapLink } from "./roadmapLink.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useLinkToRoadmapHome, useUnlinkFromRoadmapHome } from "./useRoadmapLink";

interface RoadmapLinkProps {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly home: EnvironmentId;
}

/**
 * Fork: roadmap. How an environment that is not the roadmap home reaches it,
 * shown when both it and the home can link.
 */
export function RoadmapLinkSection(props: RoadmapLinkProps) {
  const supported = useRoadmapLinkSupported(props.environmentId);
  const homeSupported = useRoadmapLinkSupported(props.home);
  return supported && homeSupported ? <RoadmapLinkRows {...props} /> : null;
}

/**
 * The client is connected to both environments, so it mints the link on the
 * home and hands it over; the user only confirms the address the environment
 * uses.
 */
function RoadmapLinkRows({ environmentId, environmentLabel, home }: RoadmapLinkProps) {
  const status = useRoadmapLinkStatus(environmentId).data;
  const clientHomeUrl = useEnvironmentHttpBaseUrl(home);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = useLinkToRoadmapHome();
  const unlink = useUnlinkFromRoadmapHome();
  const canMint = useAtomValue(roadmapEnvironment.mintRoadmapLink.permissionAtom(home));
  const canConfigure = useAtomValue(
    roadmapEnvironment.configureRoadmapLink.permissionAtom(environmentId),
  );
  const allowed = canMint && canConfigure;
  const homeUrl = draftUrl ?? status?.homeUrl ?? clientHomeUrl ?? "";
  const linked = status !== null && status.state !== "not-linked";

  const runLink = async () => {
    if (homeUrl.trim() === "" || busy) return;
    setBusy(true);
    const ok = await link({ environmentId, environmentLabel, home, homeUrl: homeUrl.trim() });
    setBusy(false);
    if (ok) setDraftUrl(null);
  };

  const runUnlink = async () => {
    const confirmed = await requestConfirmDialog(
      "Unlink from the roadmap home?\nAgents here lose the roadmap until you link again. Changes still waiting are kept and sent after the next link.",
    );
    if (confirmed !== true) return;
    setBusy(true);
    await unlink(environmentId);
    setBusy(false);
  };

  // Minute precision is plenty for "unreachable for 3h", and costs one shared timer.
  const nowMinute = useNowMinute();
  const description =
    status === null
      ? "Checking the link."
      : describeRoadmapLink(status, Date.parse(`${nowMinute}Z`)).text;

  return (
    <>
      <SettingsRow
        {...searchableSetting("roadmap-link")}
        title="Link to the roadmap home"
        description={
          allowed
            ? "The address this environment uses to reach the roadmap home. It is filled in from this client's connection; change it if this environment reaches the home another way."
            : "Linking needs access management on this environment and on the roadmap home."
        }
        control={
          <div className="flex items-center gap-2">
            <div className="w-56">
              <Input
                size="sm"
                aria-label="Roadmap home address"
                value={homeUrl}
                disabled={!allowed || busy}
                onChange={(event) => setDraftUrl(event.target.value)}
              />
            </div>
            <Button
              size="compact"
              disabled={!allowed || busy || homeUrl.trim() === ""}
              onClick={() => void runLink()}
            >
              {linked ? "Link again" : "Link"}
            </Button>
          </div>
        }
      />
      <SettingsRow
        title="Link status"
        description={description}
        control={
          linked ? (
            <Button
              size="compact"
              variant="outline"
              disabled={!canConfigure || busy}
              onClick={() => void runUnlink()}
            >
              Unlink
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
