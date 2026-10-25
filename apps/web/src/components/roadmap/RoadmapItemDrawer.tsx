/**
 * Fork: roadmap. The drawer on the Roadmap page's right that shows the
 * selected work item's details for review and inline edits. It docks beside
 * the view, so picking another item in the view switches what it shows.
 */
import type {
  EnvironmentId,
  RoadmapCommand,
  RoadmapItemId,
  RoadmapItemPatch,
  RoadmapSprint,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { PencilIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { useRoadmapAreaSettings } from "~/state/roadmap";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { RoadmapItemDetails } from "./RoadmapCardBody";
import { ROADMAP_TYPE_LABELS } from "./roadmap.logic";
import { newRoadmapCommandId, useRoadmapDispatch } from "./useRoadmapDispatch";

export interface RoadmapItemDrawerProps {
  readonly home: EnvironmentId;
  readonly item: RoadmapWorkItem;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly canEdit: boolean;
  readonly onSelect: (itemId: RoadmapItemId) => void;
  /** Opens the full editor, for the fields the drawer does not edit inline. */
  readonly onEdit: (item: RoadmapWorkItem) => void;
  readonly onClose: () => void;
}

export function RoadmapItemDrawer({
  home,
  item,
  items,
  sprints,
  canEdit,
  onSelect,
  onEdit,
  onClose,
}: RoadmapItemDrawerProps) {
  const dispatch = useRoadmapDispatch(home);
  const areaSettings = useRoadmapAreaSettings(home);

  // Opening an item an agent created counts as reviewing it, as the editor does.
  const reviewItemId = item.needsReview ? item.id : null;
  useEffect(() => {
    if (reviewItemId === null) return;
    void dispatch({
      type: "roadmap.item.mark-reviewed",
      commandId: newRoadmapCommandId(),
      itemId: reviewItemId,
    });
  }, [dispatch, reviewItemId]);

  const onUpdate = (itemId: RoadmapItemId, patch: RoadmapItemPatch) =>
    void dispatch(
      { type: "roadmap.item.update", commandId: newRoadmapCommandId(), itemId, patch },
      "Could not update the work item",
    );
  const onTick = (itemId: RoadmapItemId, criterionId: string, ticked: boolean) =>
    void dispatch(
      {
        type: "roadmap.criterion.tick",
        commandId: newRoadmapCommandId(),
        itemId,
        criterionId,
        ticked,
      },
      ticked ? "Could not tick the criterion" : "Could not untick the criterion",
    );
  const onCommand = (command: RoadmapCommand, failureTitle: string) =>
    dispatch(command, failureTitle);

  return (
    <aside
      aria-label={`Work item: ${item.title}`}
      className="flex w-96 min-w-0 shrink-0 flex-col border-s bg-background max-md:absolute max-md:inset-y-0 max-md:end-0 max-md:z-20 max-md:w-[min(24rem,100%)] max-md:shadow-lg"
    >
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {ROADMAP_TYPE_LABELS[item.type]}
        </span>
        <Button
          size="xs"
          variant="ghost"
          className="ms-auto"
          disabled={!canEdit}
          onClick={() => onEdit(item)}
        >
          <PencilIcon />
          Edit
        </Button>
        <Button size="icon-micro" variant="ghost-muted" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <ScrollArea scrollFade className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3 text-xs">
          <RoadmapItemDetails
            item={item}
            items={items}
            sprints={sprints}
            areaSettings={areaSettings}
            canChange={canEdit}
            pullRequestEnvironmentId={home}
            onOpenItem={onSelect}
            onUpdate={onUpdate}
            onTick={onTick}
            onCommand={onCommand}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}
