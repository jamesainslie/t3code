import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type {
  EnvironmentId,
  IsoDate,
  RoadmapItemId,
  RoadmapItemState,
  RoadmapWorkItem,
} from "@lathe/contracts";
import {
  ROADMAP_BOARD_STATES,
  blockedState,
  boardColumns,
  roadmapItemsById,
} from "@lathe/client-runtime/roadmap/tree";
import { effectivePriority } from "@lathe/shared/roadmap";
import { memo, useMemo, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  RoadmapBlockedBadge,
  RoadmapNeedsReviewBadge,
  RoadmapPriorityChip,
  RoadmapTypeTag,
} from "./RoadmapChips";
import { ROADMAP_STATE_LABELS, criteriaProgress } from "./roadmap.logic";
import { boardDueLabel, type BoardDueLabel } from "./roadmapPage.logic";
import { newRoadmapCommandId, useRoadmapDispatch } from "./useRoadmapDispatch";

export interface RoadmapBoardProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  /** Only descendants of this item; null shows every item. */
  readonly underId: RoadmapItemId | null;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  readonly onOpen: (item: RoadmapWorkItem) => void;
}

const isBoardState = (value: unknown): value is RoadmapItemState =>
  typeof value === "string" && (ROADMAP_BOARD_STATES as ReadonlyArray<string>).includes(value);

/** Work items in columns by state; dragging a card to another column changes its state. */
export function RoadmapBoard({ home, items, underId, canEdit, today, onOpen }: RoadmapBoardProps) {
  const dispatch = useRoadmapDispatch(home);
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const columns = useMemo(() => boardColumns(items, { underId }), [items, underId]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || !isBoardState(over.id)) return;
    const item = byId.get(String(active.id) as RoadmapItemId);
    if (item === undefined || item.state === over.id) return;
    void dispatch(
      {
        type: "roadmap.item.update",
        commandId: newRoadmapCommandId(),
        itemId: item.id,
        patch: { state: over.id },
      },
      "Could not change the state",
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ROADMAP_BOARD_STATES.map((state) => (
          <BoardColumn key={state} state={state} count={columns[state].length}>
            {columns[state].map((item) => {
              const priority = effectivePriority(item.id, byId);
              const parent = item.parentId === null ? undefined : byId.get(item.parentId);
              const progress = criteriaProgress(item.criteria);
              return (
                <BoardCard
                  key={item.id}
                  item={item}
                  priority={priority.priority}
                  priorityInherited={priority.inherited}
                  parentTitle={parent?.title ?? null}
                  blocked={blockedState(item, byId).blocked}
                  due={boardDueLabel(item, today)}
                  ticked={progress.ticked}
                  total={progress.total}
                  canEdit={canEdit}
                  onOpen={onOpen}
                />
              );
            })}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  );
}

function BoardColumn({
  state,
  count,
  children,
}: {
  readonly state: RoadmapItemState;
  readonly count: number;
  readonly children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  return (
    <section
      ref={setNodeRef}
      aria-label={ROADMAP_STATE_LABELS[state]}
      className={cn(
        "flex min-h-40 min-w-0 flex-col gap-2 rounded-xl border bg-muted/20 p-2.5",
        isOver && "border-info/50 bg-info/5",
      )}
    >
      <h2 className="flex items-center justify-between px-0.5 text-xs font-semibold text-muted-foreground">
        {ROADMAP_STATE_LABELS[state]}
        <span className="tabular-nums">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="px-0.5 py-2 text-xs text-muted-foreground/60">Nothing here</p>
      ) : (
        children
      )}
    </section>
  );
}

const DUE_TONE: Readonly<Record<BoardDueLabel["tone"], string>> = {
  default: "text-muted-foreground",
  soon: "text-warning-foreground",
  late: "text-destructive-foreground",
  done: "text-success-foreground",
};

const BoardCard = memo(function BoardCard({
  item,
  priority,
  priorityInherited,
  parentTitle,
  blocked,
  due,
  ticked,
  total,
  canEdit,
  onOpen,
}: {
  readonly item: RoadmapWorkItem;
  readonly priority: ReturnType<typeof effectivePriority>["priority"];
  readonly priorityInherited: boolean;
  readonly parentTitle: string | null;
  readonly blocked: boolean;
  readonly due: BoardDueLabel;
  readonly ticked: number;
  readonly total: number;
  readonly canEdit: boolean;
  readonly onOpen: (item: RoadmapWorkItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !canEdit,
    // The title button is the card's focus target; the card itself only drags by pointer.
    attributes: { role: "group", tabIndex: -1 },
  });
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={item.title}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-sm outline-none",
        canEdit && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "relative z-10 opacity-80 shadow-lg",
      )}
    >
      <div className="flex items-center gap-1.5">
        <RoadmapTypeTag type={item.type} />
        <RoadmapPriorityChip priority={priority} inherited={priorityInherited} />
        <span className="ms-auto flex items-center gap-1">
          {item.needsReview ? <RoadmapNeedsReviewBadge /> : null}
          {blocked ? <RoadmapBlockedBadge /> : null}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="rounded-sm text-start text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {item.title}
      </button>
      {parentTitle !== null ? (
        <p className="truncate text-xs text-muted-foreground/70">{parentTitle}</p>
      ) : null}
      <div className="flex items-center justify-between text-xs">
        <span className={due.date === null ? "text-muted-foreground/60" : "text-muted-foreground"}>
          {due.date ?? "No date"}
        </span>
        {due.left !== null ? <span className={DUE_TONE[due.tone]}>{due.left}</span> : null}
      </div>
      {total > 0 ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${Math.round((ticked / total) * 100)}%` }}
          />
        </div>
      ) : null}
    </article>
  );
});
