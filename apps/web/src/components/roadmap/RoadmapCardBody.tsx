/**
 * Fork: roadmap. What the Roadmap card shows: the attached work item with its
 * inline edits, or the ways onto the roadmap when the thread is on none.
 */
import type {
  IsoDate,
  RoadmapAreasSettings,
  RoadmapCommand,
  RoadmapCriterion,
  RoadmapItemId,
  RoadmapItemPatch,
  RoadmapItemType,
  RoadmapSprint,
  RoadmapSprintId,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { blockedState, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { effectiveArea, effectivePriority } from "@lathe/shared/roadmap";
import { addDays, isSnoozed } from "@lathe/shared/roadmapCalc";
import {
  AlarmClockIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  MapIcon,
  PinIcon,
  PinOffIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn, randomUUID } from "~/lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  ROADMAP_PRIORITIES,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_STATE_LABELS,
  ROADMAP_STATES,
  ROADMAP_TYPE_LABELS,
  ROADMAP_TYPES,
  criteriaProgress,
  localIsoDate,
} from "./roadmap.logic";
import {
  blocksOf,
  cardForecastText,
  formatUnitAmount,
  formatUnitProgress,
  formatVelocity,
  parentPath,
  roadmapActorLabel,
  roadmapCardSlots,
  snoozeChoices,
  type RoadmapCardView,
} from "./roadmapCard.logic";
import {
  RoadmapAreaBadge,
  RoadmapNeedsReviewBadge,
  RoadmapPriorityChip,
  RoadmapStateChip,
  RoadmapTypeTag,
  ROADMAP_FORECAST_TONE,
} from "./RoadmapChips";
import { formatRoadmapDate } from "./roadmapPage.logic";
import { sprintOptionsFor } from "./roadmapSprints.logic";
import { newRoadmapCommandId } from "./useRoadmapDispatch";

const INHERIT_PRIORITY = "inherit";
const NO_SPRINT = "none";

export interface RoadmapCardBodyHandlers {
  readonly onClose: () => void;
  readonly onOpenItem: (itemId: RoadmapItemId) => void;
  readonly onAttach: () => void;
  readonly onCreate: (type: RoadmapItemType) => void;
  readonly onUpdate: (itemId: RoadmapItemId, patch: RoadmapItemPatch) => void;
  readonly onTick: (itemId: RoadmapItemId, criterionId: string, ticked: boolean) => void;
  /** Resolves true once applied; a refusal, such as a fourth pin, is reported by the caller. */
  readonly onCommand: (command: RoadmapCommand, failureTitle: string) => Promise<boolean>;
}

export function RoadmapCardBody(
  props: RoadmapCardBodyHandlers & {
    readonly view: Exclude<RoadmapCardView, { kind: "hidden" }>;
    readonly items: ReadonlyArray<RoadmapWorkItem>;
    readonly sprints: ReadonlyArray<RoadmapSprint>;
    readonly areaSettings: RoadmapAreasSettings;
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

function PinButton(props: {
  readonly item: RoadmapWorkItem;
  readonly canChange: boolean;
  readonly onCommand: RoadmapCardBodyHandlers["onCommand"];
}) {
  const { item } = props;
  const pinned = item.pinnedAt !== null;
  return (
    <Button
      size="icon-micro"
      variant="ghost-muted"
      aria-label={pinned ? "Unpin from Today" : "Pin to Today"}
      aria-pressed={pinned}
      disabled={!props.canChange || (!pinned && item.state === "done")}
      onClick={() =>
        void props.onCommand(
          {
            type: pinned ? "roadmap.item.unpin" : "roadmap.item.pin",
            commandId: newRoadmapCommandId(),
            itemId: item.id,
          },
          pinned ? "Could not unpin" : "Could not pin",
        )
      }
    >
      {pinned ? <PinOffIcon /> : <PinIcon />}
    </Button>
  );
}

/** Kept to the card until the shared snooze menu lands, then replaced by it. */
function SnoozeButton(props: {
  readonly item: RoadmapWorkItem;
  readonly today: IsoDate;
  readonly canChange: boolean;
  readonly onCommand: RoadmapCardBodyHandlers["onCommand"];
}) {
  const { item, today } = props;
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const snoozed = isSnoozed(item, today);
  const close = () => {
    setOpen(false);
    setPicking(false);
  };
  const snooze = (until: IsoDate) => {
    close();
    void props.onCommand(
      { type: "roadmap.item.snooze", commandId: newRoadmapCommandId(), itemId: item.id, until },
      "Could not snooze",
    );
  };
  const unsnooze = () => {
    close();
    void props.onCommand(
      { type: "roadmap.item.unsnooze", commandId: newRoadmapCommandId(), itemId: item.id },
      "Could not unsnooze",
    );
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <PopoverTrigger
        disabled={!props.canChange || (!snoozed && item.state === "done")}
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={
              snoozed && item.snoozedUntil !== null
                ? `Snoozed until ${formatRoadmapDate(item.snoozedUntil, today)}`
                : "Snooze"
            }
          />
        }
      >
        <AlarmClockIcon />
      </PopoverTrigger>
      <PopoverPopup align="end" aria-label="Snooze until">
        {picking ? (
          <Calendar
            mode="single"
            defaultMonth={isoDateToLocal(addDays(today, 1))}
            disabled={{ before: isoDateToLocal(addDays(today, 1)) }}
            onSelect={(next: Date | undefined) => {
              if (next !== undefined) snooze(localIsoDate(next));
            }}
          />
        ) : (
          <div className="flex min-w-40 flex-col">
            {snoozeChoices(today).map((choice) => (
              <Button
                key={choice.label}
                size="xs"
                variant="ghost"
                className="justify-between"
                onClick={() => snooze(choice.until)}
              >
                {choice.label}
                <span className="text-muted-foreground">
                  {formatRoadmapDate(choice.until, today)}
                </span>
              </Button>
            ))}
            <Button
              size="xs"
              variant="ghost"
              className="justify-start"
              onClick={() => setPicking(true)}
            >
              Pick a date
            </Button>
            {snoozed ? (
              <Button size="xs" variant="ghost" className="justify-start" onClick={unsnooze}>
                Unsnooze
              </Button>
            ) : null}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function HoursField(props: {
  readonly item: RoadmapWorkItem;
  readonly total: number | null;
  readonly canChange: boolean;
  readonly onCommand: RoadmapCardBodyHandlers["onCommand"];
}) {
  const { item } = props;
  const [hours, setHours] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const canLog = props.canChange && !saving && hours !== null && hours > 0;
  const log = async () => {
    if (!canLog) return;
    setSaving(true);
    const trimmed = note.trim();
    const ok = await props.onCommand(
      {
        type: "roadmap.hours.log",
        commandId: newRoadmapCommandId(),
        itemId: item.id,
        entryId: randomUUID(),
        hours,
        ...(trimmed === "" ? {} : { note: trimmed }),
      },
      "Could not log hours",
    );
    setSaving(false);
    if (ok) {
      setHours(null);
      setNote("");
    }
  };
  // Newest first: the entry just logged is the one most likely to need undoing.
  const entries = item.hours.toReversed();
  return (
    <Popover>
      <PopoverTrigger
        disabled={!props.canChange && props.total === null}
        render={<Button size="xs" variant="ghost" aria-label="Hours" />}
      >
        {props.total === null ? "Log hours" : formatUnitAmount(props.total, "hours")}
        <ClockIcon aria-hidden />
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label="Hours">
        <div className="flex w-60 flex-col gap-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void log();
            }}
          >
            <div className="flex items-center gap-2">
              <NumberField
                value={hours}
                min={0}
                step={0.5}
                size="sm"
                disabled={!props.canChange}
                onValueChange={(next) =>
                  setHours(next === null || Number.isNaN(next) ? null : next)
                }
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label="Fewer hours" />
                  <NumberFieldInput aria-label="Hours to log" placeholder="Hours" />
                  <NumberFieldIncrement aria-label="More hours" />
                </NumberFieldGroup>
              </NumberField>
              <Button type="submit" size="xs" disabled={!canLog}>
                Log
              </Button>
            </div>
            <Input
              size="sm"
              aria-label="Note"
              placeholder="Note, optional"
              value={note}
              disabled={!props.canChange}
              onChange={(event) => setNote(event.target.value)}
            />
          </form>
          {entries.length > 0 ? (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto border-t pt-2">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="tabular-nums">{formatUnitAmount(entry.hours, "hours")}</span>
                    <span className="truncate text-2xs text-muted-foreground">
                      {[
                        roadmapActorLabel(entry.actor),
                        formatRelativeTimeLabel(entry.at),
                        entry.note,
                      ]
                        .filter((part) => part !== null && part.length > 0)
                        .join(" · ")}
                    </span>
                  </span>
                  <Button
                    size="icon-micro"
                    variant="ghost-muted"
                    aria-label="Remove entry"
                    disabled={!props.canChange}
                    onClick={() =>
                      void props.onCommand(
                        {
                          type: "roadmap.hours.remove",
                          commandId: newRoadmapCommandId(),
                          itemId: item.id,
                          entryId: entry.id,
                        },
                        "Could not remove the entry",
                      )
                    }
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function SprintField(props: {
  readonly item: RoadmapWorkItem;
  readonly options: ReadonlyArray<RoadmapSprint>;
  readonly canChange: boolean;
  readonly onUpdate: RoadmapCardBodyHandlers["onUpdate"];
}) {
  const { item } = props;
  const labels = Object.fromEntries([
    [NO_SPRINT, "None"],
    ...props.options.map((sprint) => [sprint.id, sprint.name]),
  ]);
  return (
    <Select
      value={item.sprintId ?? NO_SPRINT}
      items={labels}
      disabled={!props.canChange}
      onValueChange={(next) => {
        const sprintId = next === null || next === NO_SPRINT ? null : (next as RoadmapSprintId);
        if (sprintId !== item.sprintId) props.onUpdate(item.id, { sprintId });
      }}
    >
      <SelectTrigger variant="ghost" size="xs" aria-label="Sprint">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        <SelectItem value={NO_SPRINT}>None</SelectItem>
        {props.options.map((sprint) => (
          <SelectItem key={sprint.id} value={sprint.id}>
            {sprint.name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
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
    readonly sprints: ReadonlyArray<RoadmapSprint>;
    readonly areaSettings: RoadmapAreasSettings;
    readonly canChange: boolean;
  },
) {
  const { item, items, sprints, areaSettings, canChange, onOpenItem, onUpdate } = props;
  const today = localIsoDate(new Date());
  const byId = useMemo(() => roadmapItemsById(items), [items]);
  const priority = effectivePriority(item.id, byId);
  const area = effectiveArea(item.id, byId);
  const path = parentPath(item, byId);
  const blocked = blockedState(item, byId);
  const blocks = blocksOf(item, items);
  const criteria = criteriaProgress(item.criteria);
  const slots = useMemo(
    () => roadmapCardSlots({ item, items, sprints, areaSettings, today }),
    [areaSettings, item, items, sprints, today],
  );
  const { daysLeft } = slots;
  const forecastText = slots.forecast === null ? null : cardForecastText(slots.forecast, today);
  const snoozedUntil = isSnoozed(item, today) ? item.snoozedUntil : null;

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <RoadmapTypeTag type={item.type} />
          <Button size="xs" variant="link" className="min-w-0" onClick={() => onOpenItem(item.id)}>
            <span className="truncate text-sm font-medium">{item.title}</span>
          </Button>
          <span className="ms-auto flex shrink-0 items-center">
            <PinButton item={item} canChange={canChange} onCommand={props.onCommand} />
            <SnoozeButton
              item={item}
              today={today}
              canChange={canChange}
              onCommand={props.onCommand}
            />
          </span>
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
        {item.pinnedAt !== null ? (
          <Badge size="sm" variant="outline">
            Pinned
          </Badge>
        ) : null}
        {snoozedUntil !== null ? (
          <Badge size="sm" variant="outline">
            Snoozed until {formatRoadmapDate(snoozedUntil, today)}
          </Badge>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Due">
          <DueDateField
            dueDate={item.dueDate}
            canChange={canChange}
            onChange={(dueDate) => onUpdate(item.id, { dueDate })}
          />
        </Field>
        {daysLeft !== null ? (
          <Field label="Working days left">
            <span
              className={cn(
                "font-mono text-sm tabular-nums",
                daysLeft < 0 && "text-error-foreground",
                daysLeft >= 0 && daysLeft <= 2 && "text-warning-foreground",
              )}
            >
              {daysLeft}
            </span>
          </Field>
        ) : null}
        {slots.forecast !== null && forecastText !== null ? (
          <Field label="Forecast">
            <span className={ROADMAP_FORECAST_TONE[slots.forecast.status]}>{forecastText}</span>
          </Field>
        ) : null}
        {slots.progress !== null ? (
          <Field label="Progress">
            <span className="flex w-full min-w-0 flex-col gap-1">
              <span className="tabular-nums">{formatUnitProgress(slots.progress, slots.unit)}</span>
              <span className="h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-success"
                  style={{
                    width: `${Math.min(100, Math.round((slots.progress.burned / slots.progress.total) * 100))}%`,
                  }}
                />
              </span>
            </span>
          </Field>
        ) : null}
        {slots.velocity !== null ? (
          <Field label="Velocity">
            <span className="tabular-nums">{formatVelocity(slots.velocity, slots.unit)}</span>
          </Field>
        ) : null}
        <Field label="Estimate">
          <EstimateField
            estimate={item.estimate}
            canChange={canChange}
            onChange={(estimate) => onUpdate(item.id, { estimate })}
          />
        </Field>
        <Field label="Hours">
          <HoursField
            item={item}
            total={slots.hoursLogged}
            canChange={canChange}
            onCommand={props.onCommand}
          />
        </Field>
        {sprints.length > 0 ? (
          <Field label="Sprint">
            <SprintField
              item={item}
              options={sprintOptionsFor(sprints, area.area, item.sprintId)}
              canChange={canChange}
              onUpdate={onUpdate}
            />
          </Field>
        ) : null}
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
