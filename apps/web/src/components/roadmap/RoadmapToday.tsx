/**
 * Fork: roadmap. The Today tab: what matters now. The page hands it the live
 * roadmap; the tab reads its own thread and pull request signals.
 */
import { buildToday, type RoadmapTodaySection } from "@lathe/client-runtime/roadmap/today";
import { roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import type { EnvironmentId, IsoDate, RoadmapSprint, RoadmapWorkItem } from "@lathe/contracts";
import { effectivePriority } from "@lathe/shared/roadmap";
import { localDateOf } from "@lathe/shared/roadmapCalc";
import { ChevronRightIcon, SunIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useRoadmapAreaSettings } from "~/state/roadmap";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Separator } from "../ui/separator";
import { RoadmapTypeTag } from "./RoadmapChips";
import { RoadmapTodayRow } from "./RoadmapTodayRow";
import {
  splitTodayAtCapacity,
  todayCapacityText,
  todayHeaderDate,
  todayShortDate,
} from "./roadmapToday.logic";
import {
  type RoadmapTodayActions,
  useRoadmapTodayActions,
  useRoadmapTodayLastOpenedAt,
  useRoadmapTodaySignals,
} from "./useRoadmapToday";

export interface RoadmapTodayProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  readonly onOpen: (item: RoadmapWorkItem) => void;
}

export function RoadmapToday({ home, items, sprints, canEdit, today, onOpen }: RoadmapTodayProps) {
  // Fixed for the visit: it is both "now" for the rules and the visit Today records.
  const [now] = useState(() => new Date().toISOString());
  const lastOpenedAt = useRoadmapTodayLastOpenedAt(home, now);
  const areaSettings = useRoadmapAreaSettings(home);
  const { threadSignals, reviewRequests } = useRoadmapTodaySignals(items);
  const actions = useRoadmapTodayActions(home);
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const model = useMemo(
    () =>
      buildToday({
        items,
        sprints,
        areaSettings,
        threadSignals,
        reviewRequests,
        lastOpenedAt,
        today,
        now,
        dateOf: localDateOf,
      }),
    [areaSettings, items, lastOpenedAt, now, reviewRequests, sprints, threadSignals, today],
  );
  const split = useMemo(() => splitTodayAtCapacity(model.sections), [model.sections]);
  const capacity = todayCapacityText(model.capacity);

  const renderSections = (sections: ReadonlyArray<RoadmapTodaySection>) =>
    sections.map((section) => (
      <section key={section.id} className="flex flex-col gap-0.5" aria-label={section.title}>
        <h3 className="flex items-baseline gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground">
          {section.title}
          {section.id === "waiting" ? (
            <span className="font-normal text-muted-foreground/70">
              not counted against capacity
            </span>
          ) : null}
        </h3>
        {section.rows.map((row) => {
          const item = byId.get(row.itemId);
          if (item === undefined) return null;
          const priority = effectivePriority(item.id, byId);
          return (
            <RoadmapTodayRow
              key={row.itemId}
              item={item}
              row={row}
              priority={priority.priority}
              priorityInherited={priority.inherited}
              unit={areaSettings[row.area].unit}
              signal={threadSignals.get(row.itemId)}
              today={today}
              canEdit={canEdit}
              onOpen={onOpen}
              actions={actions}
            />
          );
        })}
      </section>
    ));

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="flex flex-wrap items-baseline gap-x-2 px-2">
        <h2 className="text-sm font-medium text-foreground">{todayHeaderDate(today)}</h2>
        {capacity !== null ? (
          <span className="text-xs text-muted-foreground">{capacity}</span>
        ) : null}
      </div>
      {model.sections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SunIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing needs you today</EmptyTitle>
            <EmptyDescription>
              Work waiting on you, your picks, and anything due, slipping or going cold shows up
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        renderSections(split.above)
      )}
      {split.beyond.length > 0 ? (
        <>
          <div className="flex items-center gap-3 px-2 text-xs text-muted-foreground">
            <Separator className="flex-1" />
            Beyond today
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-5 opacity-60">{renderSections(split.beyond)}</div>
        </>
      ) : null}
      {model.snoozed.length > 0 ? (
        <SnoozedList
          snoozed={model.snoozed}
          byId={byId}
          canEdit={canEdit}
          onOpen={onOpen}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

function SnoozedList({
  snoozed,
  byId,
  canEdit,
  onOpen,
  actions,
}: {
  readonly snoozed: ReturnType<typeof buildToday>["snoozed"];
  readonly byId: ReturnType<typeof roadmapItemsById>;
  readonly canEdit: boolean;
  readonly onOpen: (item: RoadmapWorkItem) => void;
  readonly actions: RoadmapTodayActions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger render={<Button size="xs" variant="ghost-muted" />}>
        <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
        Snoozed ({snoozed.length})
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-0.5 pt-1">
          {snoozed.map(({ itemId, until }) => {
            const item = byId.get(itemId);
            if (item === undefined) return null;
            return (
              <div
                key={itemId}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent/40"
              >
                <RoadmapTypeTag type={item.type} />
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="min-w-0 rounded-sm text-start wrap-break-word text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {item.title}
                </button>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                  until {todayShortDate(until)}
                </span>
                {canEdit ? (
                  <Button size="xs" variant="ghost-muted" onClick={() => actions.unsnooze(item)}>
                    Unsnooze
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
