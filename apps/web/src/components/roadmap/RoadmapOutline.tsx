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
  RoadmapSprint,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { blockedState, buildTree, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CrosshairIcon,
  ListChecksIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useRoadmapAreaSettings } from "~/state/roadmap";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OUTLINE_GRID_CLASS, RoadmapItemRow, type RoadmapRowActions } from "./RoadmapItemRow";
import {
  activeCollapsed,
  allCollapsed,
  ancestorIds,
  canNestInside,
  collapseAllIn,
  expandAllIn,
  expandableIds,
  filterOutlineTree,
  flattenOutline,
  focusChanges,
  forecastLabel,
  initialOutlineCollapse,
  OUTLINE_LEVELS,
  outlineDropZone,
  outlineFilterKey,
  outlineRoots,
  resolveOutlineDrop,
  roadmapForecasts,
  typeOptionsFor,
  updateOutlineCollapse,
  type OutlineDropZone,
  type RoadmapForecastLabel,
  type RoadmapOutlineFilter,
  type RoadmapOutlineLayout,
  type RoadmapOutlineLevel,
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
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly filter: RoadmapOutlineFilter;
  readonly layout: RoadmapOutlineLayout;
  readonly onLayoutChange: (layout: RoadmapOutlineLayout) => void;
  readonly selectedId: RoadmapItemId | null;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  readonly onAddChild: (parent: RoadmapWorkItem) => void;
  readonly onEdit: (item: RoadmapWorkItem) => void;
  readonly onSelect: (itemId: RoadmapItemId) => void;
}

export function RoadmapOutline({
  home,
  items,
  sprints,
  filter,
  layout,
  onLayoutChange,
  selectedId,
  canEdit,
  today,
  onAddChild,
  onEdit,
  onSelect,
}: RoadmapOutlineProps) {
  const dispatch = useRoadmapDispatch(home);
  const areaSettings = useRoadmapAreaSettings(home);
  const [collapseState, setCollapseState] = useState(() => initialOutlineCollapse(readCollapsed()));
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Select mode holds the picked ids; null when not selecting.
  const [picked, setPicked] = useState<ReadonlySet<RoadmapItemId> | null>(null);
  const byId = roadmapItemsById(items);
  const tree = buildTree(items);
  const { level, focus } = layout;
  const laidOut = outlineRoots(tree, { level, focus });
  const filtered = filterOutlineTree(laidOut, filter);
  const focusedIds = items.filter((item) => item.focusedAt !== null).map((item) => item.id);
  const filterKey = outlineFilterKey(filter);
  const collapsed = activeCollapsed(collapseState, filterKey);
  const updateCollapsed = (
    update: (current: ReadonlySet<RoadmapItemId>) => ReadonlySet<RoadmapItemId>,
  ) =>
    setCollapseState((current) => {
      const next = updateOutlineCollapse(current, filterKey, update);
      if (next.saved !== current.saved) writeCollapsed(next.saved);
      return next;
    });
  const everythingCollapsed = allCollapsed(filtered, collapsed);
  const hasExpandable = expandableIds(filtered).size > 0;
  const toggleAll = () =>
    updateCollapsed((current) =>
      everythingCollapsed ? expandAllIn(current, filtered) : collapseAllIn(current, filtered),
    );
  const setFocused = (itemId: RoadmapItemId, focused: boolean) =>
    dispatch(
      {
        type: focused ? "roadmap.item.focus" : "roadmap.item.unfocus",
        commandId: newRoadmapCommandId(),
        itemId,
      },
      "Could not change the focus set",
    );
  const applyPicked = (next: ReadonlySet<RoadmapItemId>) => {
    const changes = focusChanges(items, next);
    for (const itemId of changes.focus) void setFocused(itemId, true);
    for (const itemId of changes.unfocus) void setFocused(itemId, false);
    setPicked(null);
    onLayoutChange({ level, focus: next.size > 0 });
  };
  const forecasts = (() => {
    const labels = new Map<RoadmapItemId, RoadmapForecastLabel>();
    for (const [itemId, value] of roadmapForecasts({ items, sprints, areaSettings, today })) {
      const label = forecastLabel(value, today);
      if (label !== null) labels.set(itemId, label);
    }
    return labels;
  })();
  // A selected item is revealed even when an ancestor is collapsed.
  const effectiveCollapsed = (() => {
    if (selectedId === null) return collapsed;
    const revealed = new Set(collapsed);
    for (const ancestorId of ancestorIds(selectedId, byId)) revealed.delete(ancestorId);
    return revealed;
  })();
  const rows = flattenOutline(filtered, effectiveCollapsed);
  const rowFacts = (() => {
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
  })();

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const actions: RoadmapRowActions = {
    toggle: (itemId) =>
      updateCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(itemId)) next.add(itemId);
        return next;
      }),
    select: (itemId) =>
      setPicked((current) => {
        if (current === null) return current;
        const next = new Set(current);
        if (!next.delete(itemId)) next.add(itemId);
        return next;
      }),
    setFocused: (itemId, focused) => void setFocused(itemId, focused),
    update: (itemId: RoadmapItemId, patch: RoadmapItemPatch) =>
      void dispatch({
        type: "roadmap.item.update",
        commandId: newRoadmapCommandId(),
        itemId,
        patch,
      }),
    addChild: onAddChild,
    edit: onEdit,
    open: onSelect,
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
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const targetFor = (event: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const { active, over, activatorEvent, delta } = event;
    if (over === null || !(activatorEvent instanceof PointerEvent)) return null;
    const activeId = String(active.id) as RoadmapItemId;
    const overId = String(over.id) as RoadmapItemId;
    if (activeId === overId) return null;
    const pointerY = activatorEvent.clientY + delta.y;
    const ratio = (pointerY - over.rect.top) / Math.max(over.rect.height, 1);
    const zone = outlineDropZone(ratio, canNestInside(byId, activeId, overId));
    return resolveOutlineDrop(items, activeId, overId, zone) === null ? null : { overId, zone };
  };

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

  const toolbar = (
    <OutlineToolbar
      level={level}
      focus={focus === true}
      focusedCount={focusedIds.length}
      picked={picked}
      canEdit={canEdit}
      onLevelChange={(next) => onLayoutChange({ level: next, focus })}
      onFocusChange={(next) => onLayoutChange({ level, focus: next })}
      onClearFocus={() => applyPicked(new Set())}
      onStartSelecting={() => setPicked(new Set(focusedIds))}
      onApply={() => picked !== null && applyPicked(picked)}
      onCancel={() => setPicked(null)}
    />
  );

  if (rows.length === 0) {
    return (
      <div className="flex flex-col">
        {toolbar}
        <p className="py-12 text-center text-sm text-muted-foreground">
          {focus && focusedIds.length === 0
            ? "Nothing is in focus yet. Choose Select to pick the items to focus on."
            : "No work items match this layout and these filters."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {toolbar}
      <div
        className={`${OUTLINE_GRID_CLASS} px-2 pb-1 text-xs font-medium text-muted-foreground/70 uppercase`}
      >
        {/* Lines the toggle up with the row chevrons, after the drag handle's slot. */}
        <span className="flex items-center gap-1.5">
          {canEdit ? <span className="size-5 shrink-0" /> : null}
          {hasExpandable ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label={everythingCollapsed ? "Expand all" : "Collapse all"}
                    onClick={toggleAll}
                  />
                }
              >
                {everythingCollapsed ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
              </TooltipTrigger>
              <TooltipPopup side="top">
                {everythingCollapsed ? "Expand all" : "Collapse all"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          Item
        </span>
        <span>Pri</span>
        <span>State</span>
        <span>Due</span>
        <span>Forecast</span>
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
          const forecast = forecasts.get(node.item.id) ?? null;
          return (
            <RoadmapItemRow
              key={node.item.id}
              item={node.item}
              depth={depth}
              hasChildren={hasChildren}
              expanded={expanded}
              priority={node.priority.priority}
              priorityInherited={node.priority.inherited}
              shownArea={depth === 0 || !node.area.inherited ? node.area.area : null}
              typeOptions={facts?.typeOptions ?? []}
              blocked={facts?.blocked ?? false}
              selected={node.item.id === selectedId}
              dropZone={dropTarget?.overId === node.item.id ? dropTarget.zone : null}
              canEdit={canEdit}
              today={today}
              forecastText={forecast?.text ?? null}
              forecastStatus={forecast?.status ?? null}
              selecting={picked !== null}
              checked={picked?.has(node.item.id) ?? false}
              actions={actions}
            />
          );
        })}
      </DndContext>
    </div>
  );
}

const LEVEL_LABELS: Readonly<Record<RoadmapOutlineLevel | "tree", string>> = {
  tree: "Tree",
  epic: "Epics",
  feature: "Features",
  story: "Stories",
};

function OutlineToolbar({
  level,
  focus,
  focusedCount,
  picked,
  canEdit,
  onLevelChange,
  onFocusChange,
  onClearFocus,
  onStartSelecting,
  onApply,
  onCancel,
}: {
  readonly level: RoadmapOutlineLevel | undefined;
  readonly focus: boolean;
  readonly focusedCount: number;
  readonly picked: ReadonlySet<RoadmapItemId> | null;
  readonly canEdit: boolean;
  readonly onLevelChange: (level: RoadmapOutlineLevel | undefined) => void;
  readonly onFocusChange: (focus: boolean) => void;
  readonly onClearFocus: () => void;
  readonly onStartSelecting: () => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
      <ToggleGroup
        aria-label="Outline level"
        variant="segmented"
        value={[level ?? "tree"]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === undefined) return;
          onLevelChange(OUTLINE_LEVELS.find((candidate) => candidate === value));
        }}
      >
        {(["tree", ...OUTLINE_LEVELS] as const).map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {LEVEL_LABELS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {focusedCount > 0 || focus ? (
        <>
          <Toggle
            size="xs"
            variant="outline"
            pressed={focus}
            onPressedChange={onFocusChange}
            aria-label="Show only the focus set"
          >
            <CrosshairIcon />
            Focus · {focusedCount}
          </Toggle>
          {focusedCount > 0 && canEdit && picked === null ? (
            <Button size="xs" variant="ghost-muted" onClick={onClearFocus}>
              Clear focus
            </Button>
          ) : null}
        </>
      ) : null}
      {canEdit ? (
        <div className="ms-auto flex items-center gap-1">
          {picked === null ? (
            <Button size="xs" variant="outline" onClick={onStartSelecting}>
              <ListChecksIcon />
              Select
            </Button>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{picked.size} selected</span>
              <Button size="xs" onClick={onApply}>
                {picked.size > 0 ? `Focus on ${picked.size}` : "Clear focus"}
              </Button>
              <Button size="xs" variant="ghost-muted" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
