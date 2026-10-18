/**
 * Fork: roadmap. What the Roadmap card shows: the attached work item with its
 * inline edits, or the ways onto the roadmap when the thread is on none.
 */
import type {
  RoadmapCriterion,
  RoadmapItemId,
  RoadmapItemPatch,
  RoadmapItemType,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { blockedState, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { effectiveArea, effectivePriority } from "@lathe/shared/roadmap";
import { CalendarIcon, ChevronRightIcon, ClockIcon, MapIcon, XIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Checkbox } from "../ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import {
  ROADMAP_PRIORITIES,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_STATE_LABELS,
  ROADMAP_STATES,
  ROADMAP_TYPE_LABELS,
  ROADMAP_TYPES,
  criteriaProgress,
  localIsoDate,
  workingDaysLeft,
} from "./roadmap.logic";
import { blocksOf, parentPath, roadmapActorLabel, type RoadmapCardView } from "./roadmapCard.logic";
import {
  RoadmapAreaBadge,
  RoadmapNeedsReviewBadge,
  RoadmapPriorityChip,
  RoadmapStateChip,
  RoadmapTypeTag,
} from "./RoadmapChips";

const INHERIT_PRIORITY = "inherit";

export interface RoadmapCardBodyHandlers {
  readonly onClose: () => void;
  readonly onOpenItem: (itemId: RoadmapItemId) => void;
  readonly onAttach: () => void;
  readonly onCreate: (type: RoadmapItemType) => void;
  readonly onUpdate: (itemId: RoadmapItemId, patch: RoadmapItemPatch) => void;
  readonly onTick: (itemId: RoadmapItemId, criterionId: string, ticked: boolean) => void;
}

export function RoadmapCardBody(
  props: RoadmapCardBodyHandlers & {
    readonly view: Exclude<RoadmapCardView, { kind: "hidden" }>;
    readonly items: ReadonlyArray<RoadmapWorkItem>;
    readonly canChange: boolean;
  },
) {
  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium text-muted-foreground">
          <MapIcon className="size-3.5" aria-hidden />
          Roadmap
        </span>
        <Button size="icon-micro" variant="ghost-muted" aria-label="Close" onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {props.view.kind === "offline" ? (
        <p className="text-muted-foreground">Roadmap home is offline</p>
      ) : props.view.kind === "loading" ? (
        <p className="text-muted-foreground">Loading the roadmap…</p>
      ) : props.view.kind === "empty" ? (
        <EmptyState {...props} />
      ) : (
        <AttachedItem {...props} item={props.view.item} />
      )}
    </div>
  );
}

function EmptyState(props: RoadmapCardBodyHandlers & { readonly canChange: boolean }) {
  return (
    <>
      <p className="text-muted-foreground">This thread isn't on the roadmap.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" disabled={!props.canChange} onClick={props.onAttach}>
          Attach to work item
        </Button>
        <Menu>
          <MenuTrigger disabled={!props.canChange} render={<Button size="xs" variant="outline" />}>
            Create from this thread
          </MenuTrigger>
          <MenuPopup align="start">
            {ROADMAP_TYPES.map((type) => (
              <MenuItem key={type} onClick={() => props.onCreate(type)}>
                <RoadmapTypeTag type={type} />
                {ROADMAP_TYPE_LABELS[type]}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </>
  );
}

function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-3xs tracking-wider text-muted-foreground uppercase">{props.label}</span>
      <div className="flex min-h-6 min-w-0 items-center">{props.children}</div>
    </div>
  );
}

function ItemLinks(props: {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly onOpenItem: (itemId: RoadmapItemId) => void;
}) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      {props.items.map((linked) => (
        <Button
          key={linked.id}
          size="xs"
          variant="link"
          className="max-w-full"
          onClick={() => props.onOpenItem(linked.id)}
        >
          <span className="truncate">{linked.title}</span>
        </Button>
      ))}
    </span>
  );
}

const isoDateToLocal = (date: string) =>
  new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

function DueDateField(props: {
  readonly dueDate: string | null;
  readonly canChange: boolean;
  readonly onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = props.dueDate === null ? undefined : isoDateToLocal(props.dueDate);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={!props.canChange}
        render={<Button size="xs" variant="ghost" aria-label="Due date" />}
      >
        {selected === undefined
          ? "Set date"
          : selected.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
        <CalendarIcon aria-hidden />
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label="Choose due date">
        <Calendar
          mode="single"
          selected={selected}
          {...(selected === undefined ? {} : { defaultMonth: selected })}
          onSelect={(next) => {
            setOpen(false);
            props.onChange(next === undefined ? null : localIsoDate(next));
          }}
        />
        {props.dueDate !== null ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              props.onChange(null);
            }}
          >
            Clear due date
          </Button>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function EstimateField(props: {
  readonly estimate: number | null;
  readonly canChange: boolean;
  readonly onChange: (estimate: number | null) => void;
}) {
  return (
    <NumberField
      value={props.estimate}
      min={0}
      step={1}
      size="sm"
      disabled={!props.canChange}
      onValueCommitted={(next) => {
        if (next !== props.estimate) props.onChange(next);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label="Decrease estimate" />
        <NumberFieldInput aria-label="Estimate" placeholder="None" />
        <NumberFieldIncrement aria-label="Increase estimate" />
      </NumberFieldGroup>
    </NumberField>
  );
}

function CriterionRow(props: {
  readonly criterion: RoadmapCriterion;
  readonly canChange: boolean;
  readonly onTick: (ticked: boolean) => void;
}) {
  const { criterion } = props;
  const ticked = criterion.tickedAt !== null;
  return (
    <label className="flex items-start gap-2">
      <Checkbox
        className="mt-0.5"
        checked={ticked}
        disabled={!props.canChange}
        onCheckedChange={(checked) => props.onTick(checked)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-foreground", ticked && "text-muted-foreground")}>
          {criterion.text}
        </span>
        {ticked ? (
          <span className="text-2xs text-muted-foreground">
            {[
              criterion.tickedBy === null ? null : roadmapActorLabel(criterion.tickedBy),
              criterion.tickedAt === null ? null : formatRelativeTimeLabel(criterion.tickedAt),
              criterion.evidence,
            ]
              .filter((part) => part !== null && part.length > 0)
              .join(" · ")}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function AttachedItem(
  props: RoadmapCardBodyHandlers & {
    readonly item: RoadmapWorkItem;
    readonly items: ReadonlyArray<RoadmapWorkItem>;
    readonly canChange: boolean;
  },
) {
  const { item, items, canChange, onOpenItem, onUpdate } = props;
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const priority = effectivePriority(item.id, byId);
  const area = effectiveArea(item.id, byId);
  const path = parentPath(item, byId);
  const blocked = blockedState(item, byId);
  const blocks = blocksOf(item, items);
  const criteria = criteriaProgress(item.criteria);
  const daysLeft =
    item.dueDate === null ? null : workingDaysLeft(localIsoDate(new Date()), item.dueDate);

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <RoadmapTypeTag type={item.type} />
          <Button size="xs" variant="link" className="min-w-0" onClick={() => onOpenItem(item.id)}>
            <span className="truncate text-sm font-medium">{item.title}</span>
          </Button>
        </div>
        {path.length > 0 ? (
          <nav aria-label="Parent items" className="flex min-w-0 flex-wrap items-center">
            {path.map((ancestor, index) => (
              <span key={ancestor.id} className="flex min-w-0 items-center">
                {index > 0 ? (
                  <ChevronRightIcon className="size-3 text-muted-foreground" aria-hidden />
                ) : null}
                <Button
                  size="xs"
                  variant="link"
                  className="min-w-0"
                  onClick={() => onOpenItem(ancestor.id)}
                >
                  <span className="truncate">{ancestor.title}</span>
                </Button>
              </span>
            ))}
          </nav>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Select
          value={item.state}
          disabled={!canChange}
          onValueChange={(state) => {
            if (state !== null && state !== item.state) onUpdate(item.id, { state });
          }}
        >
          <SelectTrigger variant="ghost" size="xs" aria-label="State">
            <RoadmapStateChip state={item.state} />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {ROADMAP_STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {ROADMAP_STATE_LABELS[state]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={item.priority ?? INHERIT_PRIORITY}
          disabled={!canChange}
          onValueChange={(next) => {
            const nextPriority = ROADMAP_PRIORITIES.find((option) => option === next) ?? null;
            if (nextPriority !== item.priority) onUpdate(item.id, { priority: nextPriority });
          }}
        >
          <SelectTrigger variant="ghost" size="xs" aria-label="Priority">
            <RoadmapPriorityChip priority={priority.priority} inherited={priority.inherited} />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value={INHERIT_PRIORITY}>Inherit from parent</SelectItem>
            {ROADMAP_PRIORITIES.map((option) => (
              <SelectItem key={option} value={option}>
                {ROADMAP_PRIORITY_LABELS[option]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <RoadmapAreaBadge area={area.area} />
        {item.needsReview ? <RoadmapNeedsReviewBadge /> : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Due">
          <DueDateField
            dueDate={item.dueDate}
            canChange={canChange}
            onChange={(dueDate) => onUpdate(item.id, { dueDate })}
          />
        </Field>
        <Field label="Working days left">
          <span
            className={cn(
              "font-mono text-sm tabular-nums",
              daysLeft === null && "text-muted-foreground",
              daysLeft !== null && daysLeft < 0 && "text-error-foreground",
              daysLeft !== null && daysLeft >= 0 && daysLeft <= 2 && "text-warning-foreground",
            )}
          >
            {daysLeft ?? "None"}
          </span>
        </Field>
        <Field label="Progress">
          <span className="tabular-nums">
            {criteria.total === 0
              ? "No criteria"
              : `${criteria.ticked} of ${criteria.total} criteria`}
          </span>
        </Field>
        <Field label="Estimate">
          <EstimateField
            estimate={item.estimate}
            canChange={canChange}
            onChange={(estimate) => onUpdate(item.id, { estimate })}
          />
        </Field>
        {blocks.length > 0 ? (
          <Field label="Blocks">
            <ItemLinks items={blocks} onOpenItem={onOpenItem} />
          </Field>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="font-medium">Acceptance criteria</span>
          {criteria.total > 0 ? (
            <span className="tabular-nums">
              {criteria.ticked} of {criteria.total}
            </span>
          ) : null}
        </div>
        {item.criteria.length === 0 ? (
          <span className="text-muted-foreground">None yet</span>
        ) : (
          item.criteria.map((criterion) => (
            <CriterionRow
              key={criterion.id}
              criterion={criterion}
              canChange={canChange}
              onTick={(ticked) => props.onTick(item.id, criterion.id, ticked)}
            />
          ))
        )}
      </section>
      <section className="flex flex-col gap-1">
        <span className="font-medium text-muted-foreground">Blocked by</span>
        {blocked.blocked ? (
          <>
            <ItemLinks items={blocked.blockers} onOpenItem={onOpenItem} />
            {blocked.externalBlockers.map((blocker) => (
              <span key={blocker.id} className="text-foreground">
                {blocker.text}
              </span>
            ))}
          </>
        ) : (
          <span className="text-muted-foreground">Nothing</span>
        )}
      </section>
      <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
        <ClockIcon className="size-3" aria-hidden />
        <span className="truncate">
          Updated {formatRelativeTimeLabel(item.updatedAt)}, created by{" "}
          {roadmapActorLabel(item.createdBy)}
        </span>
      </div>
    </>
  );
}
