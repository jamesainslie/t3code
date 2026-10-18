/**
 * Fork: roadmap. The Today tab: what matters now. The page hands it the live
 * roadmap; the tab reads its own thread and pull request signals.
 */
import type { EnvironmentId, IsoDate, RoadmapSprint, RoadmapWorkItem } from "@lathe/contracts";
import { SunIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

export interface RoadmapTodayProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  readonly onOpen: (item: RoadmapWorkItem) => void;
}

export function RoadmapToday(_props: RoadmapTodayProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SunIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing needs you today</EmptyTitle>
        <EmptyDescription>
          Work waiting on you, your picks, and anything due, slipping or going cold shows up here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
