import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type {
  IsoDate,
  RoadmapArea,
  RoadmapAttachment,
  RoadmapItemId,
  RoadmapItemPatch,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapPriority,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  CrosshairIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import {
  RoadmapAreaBadge,
  RoadmapBlockedBadge,
  RoadmapFocusBadge,
  RoadmapIssueChip,
  RoadmapNeedsReviewBadge,
  RoadmapPriorityChip,
  RoadmapStateChip,
  RoadmapTypeTag,
  ROADMAP_FORECAST_TONE,
} from "./RoadmapChips";
import { RoadmapDuePicker, RoadmapEstimatePicker } from "./RoadmapFieldPickers";
import {
  ROADMAP_PRIORITIES,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_STATES,
  ROADMAP_STATE_LABELS,
  ROADMAP_TYPE_LABELS,
  criteriaProgress,
} from "./roadmap.logic";
import {
  canHaveChildren,
  type OutlineDropZone,
  type RoadmapForecastShownStatus,
} from "./roadmapPage.logic";

export const OUTLINE_GRID_CLASS =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_4.5rem_7rem_3.5rem_4.5rem_1.75rem] items-center gap-2";

/** Stable across renders, so a memoized row only re-renders when its own data changes. */
export interface RoadmapRowActions {
  readonly toggle: (itemId: RoadmapItemId) => void;
  readonly update: (itemId: RoadmapItemId, patch: RoadmapItemPatch) => void;
  readonly addChild: (item: RoadmapWorkItem) => void;
  readonly edit: (item: RoadmapWorkItem) => void;
  /** Shows the item in the drawer. */
  readonly open: (itemId: RoadmapItemId) => void;
  readonly remove: (item: RoadmapWorkItem) => void;
  readonly markReviewed: (itemId: RoadmapItemId) => void;
  readonly select: (itemId: RoadmapItemId) => void;
  readonly setFocused: (itemId: RoadmapItemId, focused: boolean) => void;
}

export interface RoadmapItemRowProps {
  readonly item: RoadmapWorkItem;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
  readonly priority: RoadmapPriority;
  readonly priorityInherited: boolean;
  /** Shown on roots and on items that set an area of their own. */
  readonly shownArea: RoadmapArea | null;
  readonly typeOptions: ReadonlyArray<RoadmapItemType>;
  readonly blocked: boolean;
  readonly selected: boolean;
  readonly dropZone: OutlineDropZone | null;
  readonly canEdit: boolean;
  readonly today: IsoDate;
  /** Text and status rather than the label object, so an unchanged forecast keeps the row memoized. */
  readonly forecastText: string | null;
  readonly forecastStatus: RoadmapForecastShownStatus | null;
  /** In Select mode the row shows a checkbox where the drag handle sits. */
  readonly selecting: boolean;
  readonly checked: boolean;
  readonly actions: RoadmapRowActions;
}

const INHERIT = "inherit";

export const RoadmapItemRow = memo(function RoadmapItemRow({
  item,
  depth,
  hasChildren,
  expanded,
  priority,
  priorityInherited,
  shownArea,
  typeOptions,
  blocked,
  selected,
  dropZone,
  canEdit,
  today,
  forecastText,
  forecastStatus,
  selecting,
  checked,
  actions,
}: RoadmapItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragNodeRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: item.id, disabled: !canEdit || selecting });
  const { setNodeRef: setDropNodeRef } = useDroppable({ id: item.id });
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  // The title of an issue this environment cannot write follows GitHub.
  const canRename = canEdit && item.source?.writable !== false;
  const progress = criteriaProgress(item.criteria);

  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      ref={(node) => {
        rowRef.current = node;
        setDropNodeRef(node);
        setDragNodeRef(node);
      }}
      data-roadmap-item={item.id}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        OUTLINE_GRID_CLASS,
        "group/row relative rounded-md px-2 py-1 text-sm",
        isDragging ? "z-10 bg-background opacity-80 shadow-md" : "hover:bg-accent/40",
        selected && "bg-accent/60",
        dropZone === "inside" && "bg-info/10 ring-1 ring-info/50 ring-inset",
      )}
    >
      {dropZone === "before" || dropZone === "after" ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-info",
            dropZone === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <div
        className="flex min-w-0 items-center gap-1.5"
        style={{ paddingInlineStart: `${depth * 20}px` }}
      >
        {selecting ? (
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Checkbox
              checked={checked}
              onCheckedChange={() => actions.select(item.id)}
              aria-label={`Select ${item.title}`}
            />
          </span>
        ) : canEdit ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${item.title}`}
            className="flex size-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 opacity-0 outline-none group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
        ) : null}
        {hasChildren ? (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={expanded ? `Collapse ${item.title}` : `Expand ${item.title}`}
            aria-expanded={expanded}
            onClick={() => actions.toggle(item.id)}
          >
            <ChevronRightIcon className={cn("transition-transform", expanded && "rotate-90")} />
          </Button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <Select
          value={item.type}
          items={ROADMAP_TYPE_LABELS}
          disabled={!canEdit}
          onValueChange={(value) => {
            if (value !== null && value !== item.type) {
              actions.update(item.id, { type: value as RoadmapItemType });
            }
          }}
        >
          <SelectTrigger
            aria-label={`Type of ${item.title}`}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0 shrink-0"
            icon={null}
          >
            <RoadmapTypeTag type={item.type} />
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {typeOptions.map((type) => (
              <SelectItem key={type} value={type}>
                {ROADMAP_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {/* Badges wrap below a long title instead of squeezing it. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {editingTitle ? (
            <TitleInput
              title={item.title}
              onDone={(next) => {
                setEditingTitle(false);
                if (next !== null && next !== item.title) actions.update(item.id, { title: next });
              }}
            />
          ) : (
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => actions.open(item.id)}
              onDoubleClick={canRename ? () => setEditingTitle(true) : undefined}
              onKeyDown={(event) => {
                if (event.key === "F2" && canRename) {
                  event.preventDefault();
                  setEditingTitle(true);
                }
              }}
              className="min-w-0 rounded-sm text-start wrap-break-word text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {item.title}
            </button>
          )}
          {item.source !== null ? <RoadmapIssueChip source={item.source} /> : null}
          {shownArea !== null ? <RoadmapAreaBadge area={shownArea} /> : null}
          {item.needsReview ? <RoadmapNeedsReviewBadge /> : null}
          {item.focusedAt !== null ? <RoadmapFocusBadge /> : null}
          {blocked ? <RoadmapBlockedBadge /> : null}
          <RoadmapThreadsLink attachments={item.attachments} />
        </div>
      </div>
      <Select
        value={priorityInherited ? INHERIT : priority}
        items={{
          [INHERIT]: `Inherit (${ROADMAP_PRIORITY_LABELS[priority]})`,
          ...ROADMAP_PRIORITY_LABELS,
        }}
        disabled={!canEdit}
        onValueChange={(value) => {
          const next = value === null || value === INHERIT ? null : (value as RoadmapPriority);
          if (next !== item.priority) actions.update(item.id, { priority: next });
        }}
      >
        <SelectTrigger
          aria-label={`Priority of ${item.title}`}
          size="compact"
          variant="ghost"
          className="w-auto min-w-0 justify-self-start"
          icon={null}
        >
          <RoadmapPriorityChip priority={priority} inherited={priorityInherited} />
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem value={INHERIT}>Inherit</SelectItem>
          {ROADMAP_PRIORITIES.map((option) => (
            <SelectItem key={option} value={option}>
              {ROADMAP_PRIORITY_LABELS[option]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={item.state}
        items={ROADMAP_STATE_LABELS}
        disabled={!canEdit}
        onValueChange={(value) => {
          if (value !== null && value !== item.state) {
            actions.update(item.id, { state: value as RoadmapItemState });
          }
        }}
      >
        <SelectTrigger
          aria-label={`State of ${item.title}`}
          size="compact"
          variant="ghost"
          className="w-auto min-w-0 justify-self-start"
          icon={null}
        >
          <RoadmapStateChip state={item.state} />
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          {ROADMAP_STATES.map((state) => (
            <SelectItem key={state} value={state}>
              {ROADMAP_STATE_LABELS[state]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <div className="min-w-0">
        <RoadmapDuePicker
          appearance="inline"
          label={`Due date of ${item.title}`}
          value={item.dueDate}
          today={today}
          disabled={!canEdit}
          onChange={(dueDate) => actions.update(item.id, { dueDate })}
        />
      </div>
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          forecastStatus === null
            ? "text-muted-foreground/60"
            : ROADMAP_FORECAST_TONE[forecastStatus],
        )}
      >
        {forecastText}
      </span>
      <div className="min-w-0">
        <RoadmapEstimatePicker
          label={`Estimate of ${item.title}`}
          value={item.estimate}
          disabled={!canEdit}
          onChange={(estimate) => actions.update(item.id, { estimate })}
        />
      </div>
      <CriteriaProgress ticked={progress.ticked} total={progress.total} />
      <Menu>
        <MenuTrigger
          disabled={!canEdit}
          render={
            <Button size="icon-xs" variant="ghost-muted" aria-label={`Actions for ${item.title}`} />
          }
        >
          <MoreHorizontalIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {canHaveChildren(item.type) ? (
            <MenuItem onClick={() => actions.addChild(item)}>
              <PlusIcon />
              Add child
            </MenuItem>
          ) : null}
          <MenuItem onClick={() => actions.edit(item)}>
            <PencilIcon />
            Edit
          </MenuItem>
          <MenuItem onClick={() => actions.setFocused(item.id, item.focusedAt === null)}>
            <CrosshairIcon />
            {item.focusedAt === null ? "Add to focus" : "Remove from focus"}
          </MenuItem>
          {item.needsReview ? (
            <MenuItem onClick={() => actions.markReviewed(item.id)}>
              <CheckIcon />
              Mark reviewed
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => actions.remove(item)}>
            <Trash2Icon />
            Delete
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  );
});

function TitleInput({
  title,
  onDone,
}: {
  readonly title: string;
  /** Null means the edit was cancelled. */
  readonly onDone: (next: string | null) => void;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <Input
      size="sm"
      autoFocus
      aria-label="Title"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value.trim() === "" ? null : value.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(value.trim() === "" ? null : value.trim());
        }
        if (event.key === "Escape") {
          // Keeps the page's Escape-to-go-back from also firing.
          event.preventDefault();
          finish(null);
        }
      }}
    />
  );
}

function CriteriaProgress({ ticked, total }: { readonly ticked: number; readonly total: number }) {
  if (total === 0) return <span className="text-xs text-muted-foreground/60">None</span>;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${Math.round((ticked / total) * 100)}%` }}
        />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {ticked}/{total}
      </span>
    </div>
  );
}

function RoadmapThreadsLink({
  attachments,
}: {
  readonly attachments: ReadonlyArray<RoadmapAttachment>;
}) {
  if (attachments.length === 0) return null;
  if (attachments.length === 1) {
    const { environmentId, threadId } = attachments[0]!.thread;
    return (
      <Button
        size="micro"
        variant="ghost-muted"
        render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
      >
        1 thread
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger render={<Button size="micro" variant="ghost-muted" />}>
        {attachments.length} threads
      </MenuTrigger>
      <MenuPopup align="start">
        {attachments.map((attachment) => (
          <ThreadMenuItem
            key={`${attachment.thread.environmentId}:${attachment.thread.threadId}`}
            attachment={attachment}
          />
        ))}
      </MenuPopup>
    </Menu>
  );
}

function ThreadMenuItem({ attachment }: { readonly attachment: RoadmapAttachment }) {
  const { environmentId, threadId } = attachment.thread;
  const shell = useThreadShell(attachment.thread);
  return (
    <MenuItem render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}>
      <span className="truncate">{shell?.title?.trim() || "Thread not loaded"}</span>
    </MenuItem>
  );
}
