/**
 * Fork: roadmap. One Today row: the item, why it is here, and what it costs.
 * Hovering or focusing the row swaps the reason for its actions.
 */
import type {
  RoadmapThreadSignal,
  RoadmapTodayRow as TodayRow,
} from "@lathe/client-runtime/roadmap/today";
import type {
  IsoDate,
  RoadmapPriority,
  RoadmapThreadRef,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ClockIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RoadmapAreaBadge, RoadmapPriorityChip, RoadmapTypeTag } from "./RoadmapChips";
import { RoadmapSnoozeMenu } from "./RoadmapSnoozeMenu";
import {
  todayEstimateText,
  todayOpenThreads,
  todayReasonTone,
  type TodayReasonTone,
} from "./roadmapToday.logic";
import type { RoadmapTodayActions } from "./useRoadmapToday";

const REASON_TONE: Readonly<Record<TodayReasonTone, string>> = {
  destructive: "text-destructive-foreground",
  warning: "text-warning-foreground",
  muted: "text-muted-foreground",
};

export interface RoadmapTodayRowProps {
  readonly item: RoadmapWorkItem;
  readonly row: TodayRow;
  readonly priority: RoadmapPriority;
  readonly priorityInherited: boolean;
  readonly unit: RoadmapUnit;
  readonly signal: RoadmapThreadSignal | undefined;
  readonly today: IsoDate;
  readonly canEdit: boolean;
  readonly onOpen: (item: RoadmapWorkItem) => void;
  readonly actions: RoadmapTodayActions;
}

export const RoadmapTodayRow = memo(function RoadmapTodayRow({
  item,
  row,
  priority,
  priorityInherited,
  unit,
  signal,
  today,
  canEdit,
  onOpen,
  actions,
}: RoadmapTodayRowProps) {
  // A menu renders in a portal, outside the row's hover and focus, so the
  // actions stay shown while one is open.
  const [menuOpen, setMenuOpen] = useState(false);
  const estimate = todayEstimateText(row, unit);
  const threads = todayOpenThreads(item, signal);

  return (
    <div
      data-active={menuOpen || undefined}
      className="group/row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40 data-active:bg-accent/40"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <RoadmapTypeTag type={item.type} />
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="min-w-0 truncate rounded-sm text-start text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {item.title}
        </button>
        <RoadmapAreaBadge area={row.area} />
        <RoadmapPriorityChip priority={priority} inherited={priorityInherited} />
      </div>
      <div className="flex items-center gap-3 text-xs group-hover/row:hidden group-focus-within/row:hidden group-data-active/row:hidden">
        <span className={cn("truncate", REASON_TONE[todayReasonTone(row)])}>{row.reason}</span>
        {estimate.amount !== null ? (
          <span className="shrink-0 text-muted-foreground tabular-nums">{estimate.amount}</span>
        ) : null}
        {estimate.hint !== null ? (
          <span className="shrink-0 text-muted-foreground/70">{estimate.hint}</span>
        ) : null}
      </div>
      <div className="hidden items-center gap-1 group-hover/row:flex group-focus-within/row:flex group-data-active/row:flex">
        <OpenThreadButton threads={threads} onOpenChange={setMenuOpen} />
        {canEdit ? (
          <>
            <Button size="xs" variant="ghost-muted" onClick={() => actions.newThread(item)}>
              <PlusIcon />
              New thread
            </Button>
            <RoadmapSnoozeMenu
              today={today}
              onSnooze={(until) => actions.snooze(item, until)}
              onOpenChange={setMenuOpen}
              render={<Button size="xs" variant="ghost-muted" />}
            >
              <ClockIcon />
              Snooze
            </RoadmapSnoozeMenu>
            <Button size="xs" variant="ghost-muted" onClick={() => actions.done(item)}>
              <CheckIcon />
              Done
            </Button>
            <Button size="xs" variant="ghost-muted" onClick={() => actions.togglePin(item)}>
              {item.pinnedAt === null ? <PinIcon /> : <PinOffIcon />}
              {item.pinnedAt === null ? "Pin" : "Unpin"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
});

function OpenThreadButton({
  threads,
  onOpenChange,
}: {
  readonly threads: ReadonlyArray<RoadmapThreadRef>;
  readonly onOpenChange: (open: boolean) => void;
}) {
  if (threads.length === 0) return null;
  if (threads.length === 1) {
    const { environmentId, threadId } = threads[0]!;
    return (
      <Button
        size="xs"
        variant="ghost-muted"
        render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
      >
        <ArrowUpRightIcon />
        Open thread
      </Button>
    );
  }
  return (
    <Menu onOpenChange={onOpenChange}>
      <MenuTrigger render={<Button size="xs" variant="ghost-muted" />}>
        <ArrowUpRightIcon />
        Open thread
      </MenuTrigger>
      <MenuPopup align="end">
        {threads.map((thread) => (
          <ThreadMenuItem key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
        ))}
      </MenuPopup>
    </Menu>
  );
}

function ThreadMenuItem({ thread }: { readonly thread: RoadmapThreadRef }) {
  const { environmentId, threadId } = thread;
  const shell = useThreadShell(thread);
  return (
    <MenuItem render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}>
      <span className="truncate">{shell?.title?.trim() || "Thread not loaded"}</span>
    </MenuItem>
  );
}
