import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import type {
  EnvironmentId,
  IsoDate,
  RoadmapItemId,
  RoadmapItemPatch,
  RoadmapItemType,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { blockedState, buildTree, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toastManager } from "../ui/toast";
import { OUTLINE_GRID_CLASS, RoadmapItemRow, type RoadmapRowActions } from "./RoadmapItemRow";
import {
  ancestorIds,
  canNestInside,
  filterOutlineTree,
  flattenOutline,
  outlineDropZone,
  resolveOutlineDrop,
  typeOptionsFor,
  type OutlineDropZone,
  type RoadmapOutlineFilter,
} from "./roadmapPage.logic";
import { newRoadmapCommandId, useRoadmapDispatch } from "./useRoadmapDispatch";

const COLLAPSED_STORAGE_KEY = "lathe:roadmap:collapsed";

function readCollapsed(): ReadonlySet<RoadmapItemId> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter((entry): entry is RoadmapItemId => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeCollapsed(collapsed: ReadonlySet<RoadmapItemId>) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Storage can be full or blocked; collapse state then lasts for the session only.
  }
}

interface DropTarget {
  readonly overId: RoadmapItemId;
  readonly zone: OutlineDropZone;
}

export interface RoadmapOutlineProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly filter: RoadmapOutlineFilter;
  readonly selectedId: RoadmapItemId | null;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  readonly onAddChild: (parent: RoadmapWorkItem) => void;
  readonly onEdit: (item: RoadmapWorkItem) => void;
}

export function RoadmapOutline({
  home,
  items,
  filter,
  selectedId,
  canEdit,
  today,
  onAddChild,
  onEdit,
}: RoadmapOutlineProps) {
  const dispatch = useRoadmapDispatch(home);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const tree = useMemo(() => buildTree(items), [items]);
  const filtered = useMemo(() => filterOutlineTree(tree, filter), [filter, tree]);
  const filtering =
    filter.area !== undefined || filter.type !== undefined || filter.state !== undefined;
  // A selected item is revealed even when an ancestor is collapsed.
  const effectiveCollapsed = useMemo(() => {
    if (selectedId === null) return collapsed;
    const revealed = new Set(collapsed);
    for (const ancestorId of ancestorIds(selectedId, byId)) revealed.delete(ancestorId);
    return revealed;
  }, [byId, collapsed, selectedId]);
  const rows = useMemo(
    () => flattenOutline(filtered, effectiveCollapsed, filtering),
    [effectiveCollapsed, filtered, filtering],
  );
  const rowFacts = useMemo(() => {
    const childTypes = new Map<RoadmapItemId, Array<RoadmapItemType>>();
    for (const item of items) {
      if (item.parentId === null) continue;
      const types = childTypes.get(item.parentId) ?? [];
      types.push(item.type);
      childTypes.set(item.parentId, types);
    }
    return new Map(
      items.map((item) => {
        const parentType = item.parentId === null ? null : (byId.get(item.parentId)?.type ?? null);
        return [
          item.id,
          {
            typeOptions: typeOptionsFor(parentType, childTypes.get(item.id) ?? []),
            blocked: blockedState(item, byId).blocked,
          },
        ] as const;
      }),
    );
  }, [byId, items]);

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const actions = useMemo<RoadmapRowActions>(
    () => ({
      toggle: (itemId) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (!next.delete(itemId)) next.add(itemId);
          writeCollapsed(next);
          return next;
        }),
      update: (itemId: RoadmapItemId, patch: RoadmapItemPatch) =>
        void dispatch({
          type: "roadmap.item.update",
          commandId: newRoadmapCommandId(),
          itemId,
          patch,
        }),
      addChild: onAddChild,
      edit: onEdit,
      markReviewed: (itemId) =>
        void dispatch({
          type: "roadmap.item.mark-reviewed",
          commandId: newRoadmapCommandId(),
          itemId,
        }),
      remove: (item) => {
        const current = roadmapItemsById(itemsRef.current);
        const childCount = itemsRef.current.filter((entry) =>
          ancestorIds(entry.id, current).includes(item.id),
        ).length;
        void dispatch(
          { type: "roadmap.item.delete", commandId: newRoadmapCommandId(), itemId: item.id },
          "Could not delete the work item",
        ).then((deleted) => {
          if (!deleted) return;
          const toastId = toastManager.add({
            type: "success",
            title: `Deleted ${item.title}`,
            ...(childCount > 0
              ? {
                  description: `With ${childCount} item${childCount === 1 ? "" : "s"} under it.`,
                }
              : {}),
            actionProps: {
              children: "Undo",
              onClick: () => {
                toastManager.close(toastId);
                void dispatch(
                  {
                    type: "roadmap.item.restore",
                    commandId: newRoadmapCommandId(),
                    itemId: item.id,
                  },
                  "Could not restore the work item",
                );
              },
            },
          });
        });
      },
    }),
    [dispatch, onAddChild, onEdit],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const targetFor = useCallback(
    (event: DragMoveEvent | DragEndEvent): DropTarget | null => {
      const { active, over, activatorEvent, delta } = event;
      if (over === null || !(activatorEvent instanceof PointerEvent)) return null;
      const activeId = String(active.id) as RoadmapItemId;
      const overId = String(over.id) as RoadmapItemId;
      if (activeId === overId) return null;
      const pointerY = activatorEvent.clientY + delta.y;
      const ratio = (pointerY - over.rect.top) / Math.max(over.rect.height, 1);
      const zone = outlineDropZone(ratio, canNestInside(byId, activeId, overId));
      return resolveOutlineDrop(items, activeId, overId, zone) === null ? null : { overId, zone };
    },
    [byId, items],
  );

  const handleDragMove = (event: DragMoveEvent) => {
    const next = targetFor(event);
    setDropTarget((current) =>
      current?.overId === next?.overId && current?.zone === next?.zone ? current : next,
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDropTarget(null);
    const target = targetFor(event);
    if (target === null) return;
    const itemId = String(event.active.id) as RoadmapItemId;
    const move = resolveOutlineDrop(items, itemId, target.overId, target.zone);
    if (move === null) return;
    void dispatch(
      { type: "roadmap.item.move", commandId: newRoadmapCommandId(), itemId, ...move },
      "Could not move the work item",
    );
  };

  if (rows.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No work items match these filters.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      <div
        className={`${OUTLINE_GRID_CLASS} px-2 pb-1 text-xs font-medium text-muted-foreground/70 uppercase`}
      >
        <span>Item</span>
        <span>Pri</span>
        <span>State</span>
        <span>Due</span>
        <span>Est</span>
        <span>Criteria</span>
        <span />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDropTarget(null)}
      >
        {rows.map(({ node, depth, hasChildren, expanded }) => {
          const facts = rowFacts.get(node.item.id);
          return (
            <RoadmapItemRow
              key={node.item.id}
              item={node.item}
              depth={depth}
              hasChildren={hasChildren}
              expanded={expanded}
              priority={node.priority.priority}
              priorityInherited={node.priority.inherited}
              shownArea={
                node.item.parentId === null || !node.area.inherited ? node.area.area : null
              }
              typeOptions={facts?.typeOptions ?? []}
              blocked={facts?.blocked ?? false}
              selected={node.item.id === selectedId}
              dropZone={dropTarget?.overId === node.item.id ? dropTarget.zone : null}
              canEdit={canEdit}
              today={today}
              actions={actions}
            />
          );
        })}
      </DndContext>
    </div>
  );
}
