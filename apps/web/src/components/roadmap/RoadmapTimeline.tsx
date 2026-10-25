/**
 * Fork: roadmap. The Timeline tab: dated work on a calendar with forecasts,
 * blockers and sprints. The page owns the area filter and the selected item.
 *
 * Every row is drawn, without windowing: rows are only the dated items of one
 * person's roadmap, each costs a handful of elements, rows are memoized so a
 * selection change re-renders two of them, and the vertical scroller belongs
 * to the page. Elements scale with rows, never with days.
 */
import {
  defaultTimelineRange,
  layoutTimeline,
  type RoadmapTimelineRange,
  type RoadmapTimelineRow,
} from "@lathe/client-runtime/roadmap/timeline";
import type {
  EnvironmentId,
  IsoDate,
  RoadmapArea,
  RoadmapItemId,
  RoadmapPriority,
  RoadmapSprint,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { effectivePriority } from "@lathe/shared/roadmap";
import { localDateOf, type RoadmapForecastStatus } from "@lathe/shared/roadmapCalc";
import { ChartGanttIcon } from "lucide-react";
import { memo, useLayoutEffect, useRef } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { useRoadmapAreaSettings } from "~/state/roadmap";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RoadmapPriorityChip, RoadmapTypeTag, roadmapTypeHue } from "./RoadmapChips";
import {
  hiddenWithoutDatesNote,
  TIMELINE_DAY_WIDTH,
  TIMELINE_ROW_HEIGHT,
  timelineBarGeometry,
  timelineBarTitle,
  timelineCurrentSprint,
  timelineDisplayRows,
  timelineEdgePaths,
  timelineMetrics,
  timelineSpan,
  timelineTodayX,
  timelineWeekTicks,
} from "./roadmapTimeline.logic";

export interface RoadmapTimelineProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly area: RoadmapArea | null;
  readonly today: IsoDate;
  readonly selectedId: RoadmapItemId | null;
  readonly onSelect: (itemId: RoadmapItemId) => void;
}

const LABEL_INDENT = 16;
const LABEL_PADDING = 8;
// A week of context before today, since the default range can reach far back.
const TODAY_SCROLL_LEAD = 7 * TIMELINE_DAY_WIDTH;

const FORECAST_TONE: Readonly<Record<RoadmapForecastStatus, string>> = {
  late: "border-destructive bg-destructive/8 text-destructive-foreground",
  "at-risk": "border-warning bg-warning/8 text-warning-foreground",
  "on-track": "border-success bg-success/8 text-success-foreground",
  "no-forecast": "border-border text-muted-foreground",
};

export function RoadmapTimeline({
  home,
  items,
  sprints,
  area,
  today,
  selectedId,
  onSelect,
}: RoadmapTimelineProps) {
  const areaSettings = useRoadmapAreaSettings(home);
  const select = useStableCallback(onSelect);
  const byId = new Map(items.map((item) => [item.id, item]));
  const metrics = timelineMetrics({ items, sprints, today, areaSettings, dateOf: localDateOf });
  // Across both areas, so switching the area filter never shifts the axis.
  const range = defaultTimelineRange({
    items,
    forecasts: metrics.forecasts,
    today,
    dateOf: localDateOf,
  });
  const layout = layoutTimeline({
    items,
    sprints,
    today,
    forecasts: metrics.forecasts,
    progress: metrics.progress,
    range,
    area,
    dateOf: localDateOf,
  });
  const display = timelineDisplayRows(layout);
  const edges = timelineEdgePaths(layout, display.displayIndexOf);
  const ticks = timelineWeekTicks(range);
  const priorities = (() => {
    const result = new Map<RoadmapItemId, { priority: RoadmapPriority; inherited: boolean }>();
    for (const row of layout.rows) result.set(row.itemId, effectivePriority(row.itemId, byId));
    for (const group of layout.groups) {
      result.set(group.rootId, effectivePriority(group.rootId, byId));
    }
    return result;
  })();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrolledToToday = useRef(false);
  const todayX = layout.todayOffset === null ? null : timelineTodayX(layout.todayOffset);
  const hasRows = layout.rows.length > 0;
  const currentSprint = timelineCurrentSprint(layout.sprintBands, layout.todayOffset);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    // The scroller mounts with the first dated row, which may arrive after the first render.
    if (!hasRows || scrolledToToday.current || scroller === null || todayX === null) return;
    scrolledToToday.current = true;
    scroller.scrollLeft = Math.max(0, todayX - TODAY_SCROLL_LEAD);
  }, [hasRows, todayX]);

  const note = hiddenWithoutDatesNote(layout.hiddenWithoutDates);
  if (!hasRows) {
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
            {note === null ? null : ` ${note}.`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const width = layout.days * TIMELINE_DAY_WIDTH;
  const lanesHeight = display.rows.length * TIMELINE_ROW_HEIGHT;
  const hasSprints = layout.sprintBands.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="flex">
        <div className="w-max max-w-[40%] min-w-64 shrink-0 border-r border-border">
          <div className={hasSprints ? "h-12" : "h-7"} />
          {display.rows.map((entry) => {
            const row = entry.kind === "item" ? layout.rows[entry.row] : undefined;
            const itemId = entry.kind === "group" ? entry.groupId : row?.itemId;
            const item = itemId === undefined ? undefined : byId.get(itemId);
            const priority = itemId === undefined ? undefined : priorities.get(itemId);
            if (item === undefined || priority === undefined) return null;
            return (
              <TimelineLabel
                key={entry.kind === "group" ? `group:${item.id}` : item.id}
                item={item}
                depth={row?.depth ?? 0}
                heading={entry.kind === "group" || entry.groupHead}
                priority={priority.priority}
                priorityInherited={priority.inherited}
                selected={item.id === selectedId}
                onSelect={select}
              />
            );
          })}
        </div>
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ width }}>
            <div className="relative h-7 text-3xs text-muted-foreground tabular-nums">
              {ticks.map((tick) => (
                <span
                  key={tick.offset}
                  className="absolute top-1/2 -translate-y-1/2 pl-1.5 whitespace-nowrap"
                  style={{ left: tick.offset * TIMELINE_DAY_WIDTH }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            {hasSprints ? (
              <div className="relative h-5 text-3xs text-muted-foreground">
                {layout.sprintBands.map((band) => {
                  const span = timelineSpan(band.start, band.end, layout.days);
                  return span === null ? null : (
                    <span
                      key={band.sprintId}
                      className={cn(
                        "absolute top-0 truncate px-1.5",
                        band.sprintId === currentSprint && "font-semibold text-foreground",
                      )}
                      style={{ left: span.left, width: span.width }}
                    >
                      {band.name}
                    </span>
                  );
                })}
              </div>
            ) : null}
            <div className="relative" style={{ height: lanesHeight }}>
              {layout.sprintBands.map((band) => {
                const span = timelineSpan(band.start, band.end, layout.days);
                return span === null ? null : (
                  <div
                    key={band.sprintId}
                    className={cn(
                      "pointer-events-none absolute inset-y-0 border-x border-border/50",
                      band.sprintId === currentSprint && "bg-foreground/5",
                    )}
                    style={{ left: span.left, width: span.width }}
                  />
                );
              })}
              {display.rows.map((entry) => {
                if (entry.kind === "group") {
                  return <div key={`group:${entry.groupId}`} className={LANE_CLASS} />;
                }
                const row = layout.rows[entry.row];
                const item = row === undefined ? undefined : byId.get(row.itemId);
                if (row === undefined || item === undefined) return null;
                return (
                  <TimelineLane
                    key={row.itemId}
                    item={item}
                    row={row}
                    days={layout.days}
                    range={range}
                    selected={item.id === selectedId}
                    onSelect={select}
                  />
                );
              })}
              <svg
                className="pointer-events-none absolute inset-0 overflow-visible text-muted-foreground/70"
                width={width}
                height={lanesHeight}
                aria-hidden
              >
                {edges.map((edge) => (
                  <path
                    key={edge.key}
                    d={edge.d}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                ))}
              </svg>
              {todayX === null ? null : (
                <div
                  className="pointer-events-none absolute inset-y-0 border-l-2 border-destructive"
                  style={{ left: todayX }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const LANE_CLASS = "relative h-9 border-b border-border/40";

// A faint tint and outline mark the span and only the done part is painted in
// full, so work in flight stands out and unstarted work stays quiet. The theme
// sets color-scheme, which picks each light-dark() side.
const barColors = (hue: string) => ({
  borderColor: `light-dark(color-mix(in oklch, ${hue} 83%, black), color-mix(in srgb, ${hue} 80%, transparent))`,
  backgroundColor: `light-dark(color-mix(in srgb, ${hue} 10%, transparent), color-mix(in srgb, ${hue} 13%, transparent))`,
});
const fillColor = (hue: string) =>
  `light-dark(color-mix(in oklch, ${hue} 75%, white), color-mix(in oklch, ${hue} 83%, black))`;

interface TimelineLabelProps {
  readonly item: RoadmapWorkItem;
  readonly depth: number;
  readonly heading: boolean;
  readonly priority: RoadmapPriority;
  readonly priorityInherited: boolean;
  readonly selected: boolean;
  readonly onSelect: (itemId: RoadmapItemId) => void;
}

const TimelineLabel = memo(function TimelineLabel({
  item,
  depth,
  heading,
  priority,
  priorityInherited,
  selected,
  onSelect,
}: TimelineLabelProps) {
  // Labels keep the lane height to line up with their bars, so a title longer than
  // the column's cap is cut here and shown in full on hover.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center gap-1.5 border-b border-border/40 pr-2 text-left text-sm outline-none hover:bg-accent/40 focus-visible:bg-accent/40",
              selected && "bg-accent/60",
            )}
            style={{ paddingLeft: LABEL_PADDING + depth * LABEL_INDENT }}
            onClick={() => onSelect(item.id)}
          />
        }
      >
        <RoadmapTypeTag type={item.type} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            heading && "font-medium",
            item.state === "done" && "text-muted-foreground",
          )}
        >
          {item.title}
        </span>
        <RoadmapPriorityChip priority={priority} inherited={priorityInherited} />
      </TooltipTrigger>
      <TooltipPopup side="right">{item.title}</TooltipPopup>
    </Tooltip>
  );
});

interface TimelineLaneProps {
  readonly item: RoadmapWorkItem;
  readonly row: RoadmapTimelineRow;
  readonly days: number;
  readonly range: RoadmapTimelineRange;
  readonly selected: boolean;
  readonly onSelect: (itemId: RoadmapItemId) => void;
}

const TimelineLane = memo(function TimelineLane({
  item,
  row,
  days,
  range,
  selected,
  onSelect,
}: TimelineLaneProps) {
  const geometry = timelineBarGeometry(row, days);
  const title = timelineBarTitle(item.title, row, range);
  const hue = roadmapTypeHue(item.type);
  return (
    <div className={LANE_CLASS}>
      {geometry.bar === null ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(
                  "absolute top-1/2 flex h-5 -translate-y-1/2 items-center overflow-hidden rounded-md border px-2 text-2xs font-medium whitespace-nowrap text-foreground tabular-nums outline-none hover:brightness-125",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  row.done && "opacity-50",
                  selected && "ring-2 ring-ring ring-inset",
                )}
                // Eight type hues and only a few theme colours, as the type tags do.
                style={{
                  left: geometry.bar.left,
                  width: geometry.bar.width,
                  ...barColors(hue),
                }}
                aria-label={title}
                onClick={() => onSelect(item.id)}
              />
            }
          >
            {geometry.fill === null ? null : (
              <span
                className="absolute inset-y-0 left-0"
                style={{ width: geometry.fill, backgroundColor: fillColor(hue) }}
              />
            )}
            <span className="relative">{geometry.label}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{title}</TooltipPopup>
        </Tooltip>
      )}
      {geometry.forecast === null ? null : (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded-r-md border border-l-0 border-dashed px-1.5 text-3xs whitespace-nowrap",
            FORECAST_TONE[geometry.forecast.status],
          )}
          style={{ left: geometry.forecast.left, width: geometry.forecast.width }}
        >
          {geometry.forecast.label}
        </div>
      )}
      {geometry.dueX === null ? null : (
        <div
          className="pointer-events-none absolute top-1/2 h-6.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70"
          style={{ left: geometry.dueX }}
        />
      )}
    </div>
  );
});
