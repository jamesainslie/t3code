/**
 * Fork: forecast, burn and velocity for work items on the server, for the MCP
 * tools and the turn context. The arithmetic is `@lathe/shared/roadmapCalc`,
 * the same the clients run, so an agent and the Roadmap page agree.
 */
import type {
  IsoDate,
  RoadmapAreasSettings,
  RoadmapSprint,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { effectiveArea } from "@lathe/shared/roadmap";
import {
  burned,
  forecast,
  type RoadmapForecast,
  type RoadmapItemsById,
  type RoadmapVelocity,
  remaining,
  totalUnits,
  velocity,
} from "@lathe/shared/roadmapCalc";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export interface RoadmapItemProgress {
  readonly unit: RoadmapUnit;
  readonly burned: number;
  readonly remaining: number | null;
  /** The item's scope in the unit; null without estimates to count. */
  readonly total: number | null;
  readonly velocity: RoadmapVelocity | null;
  readonly forecast: RoadmapForecast;
}

/**
 * Today as a UTC date. The server does not know the user's time zone, so its
 * dates can differ from the client's by one near midnight; the clients compute
 * their own views in local time.
 */
export const todayUtc: Effect.Effect<IsoDate> = DateTime.now.pipe(
  Effect.map(DateTime.formatIsoDateUtc),
);

/**
 * A calculator over one snapshot of the roadmap. Velocity depends only on the
 * area and whether the item is in a sprint, so it is computed once per pair
 * and a whole list costs four velocity passes at most.
 */
export function progressCalculator(input: {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly areas: RoadmapAreasSettings;
  readonly today: IsoDate;
}): {
  readonly byId: RoadmapItemsById;
  readonly progressOf: (item: RoadmapWorkItem) => RoadmapItemProgress;
} {
  const { items, sprints, areas, today } = input;
  const byId: RoadmapItemsById = new Map(items.map((item) => [item.id, item]));
  const velocities = new Map<string, RoadmapVelocity | null>();

  const progressOf = (item: RoadmapWorkItem): RoadmapItemProgress => {
    const area = effectiveArea(item.id, byId).area;
    const settings = areas[area];
    const useSprints = item.sprintId !== null;
    const key = `${area}:${useSprints}`;
    if (!velocities.has(key)) {
      velocities.set(key, velocity({ items, area, settings, today, sprints, useSprints }));
    }
    const areaVelocity = velocities.get(key) ?? null;
    const { unit } = settings;
    return {
      unit,
      burned: burned(item, byId, unit),
      remaining: remaining(item, byId, unit),
      total: totalUnits(item, byId, unit),
      velocity: areaVelocity,
      forecast: forecast({
        item,
        byId,
        unit,
        velocity: areaVelocity,
        today,
        weekdays: settings.workingWeekdays,
      }),
    };
  };
  return { byId, progressOf };
}
