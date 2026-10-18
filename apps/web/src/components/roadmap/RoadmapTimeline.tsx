/**
 * Fork: roadmap. The Timeline tab: dated work on a calendar with forecasts,
 * blockers and sprints. The page owns the area filter and the selected item.
 */
import type {
  EnvironmentId,
  IsoDate,
  RoadmapArea,
  RoadmapItemId,
  RoadmapSprint,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { ChartGanttIcon } from "lucide-react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";

export interface RoadmapTimelineProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly area: RoadmapArea | null;
  readonly today: IsoDate;
  readonly selectedId: RoadmapItemId | null;
  readonly onSelect: (itemId: RoadmapItemId) => void;
}

export function RoadmapTimeline(_props: RoadmapTimelineProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ChartGanttIcon />
        </EmptyMedia>
        <EmptyTitle>Nothing on the timeline yet</EmptyTitle>
        <EmptyDescription>
          Give work items a start or due date to see them here, with forecasts, blockers and
          sprints.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
