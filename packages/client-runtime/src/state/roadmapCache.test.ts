import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, RoadmapItemId, type RoadmapWorkItem } from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { RoadmapLiveState } from "../roadmap/roadmapTree.ts";
import { RoadmapCacheStore, withRoadmapCache } from "./roadmapCache.ts";

const home = EnvironmentId.make("home");
const other = EnvironmentId.make("other");
const at = "2026-10-19T09:00:00.000Z";

const item = (itemId: string, title: string): RoadmapWorkItem => ({
  id: RoadmapItemId.make(itemId),
  type: "epic",
  title,
  description: "",
  parentId: null,
  sortKey: "n",
  state: "backlog",
  priority: null,
  area: null,
  dueDate: null,
  startDate: null,
  estimate: null,
  criteria: [],
  blockedBy: [],
  externalBlockers: [],
  related: [],
  attachments: [],
  origin: null,
  needsReview: false,
  createdAt: at,
  updatedAt: at,
  createdBy: { _tag: "user" },
  stateChangedAt: at,
  completedAt: null,
  pinnedAt: null,
  focusedAt: null,
  snoozedUntil: null,
  sprintId: null,
  hours: [],
  progressNotes: [],
  source: null,
  pullRequests: [],
});

const state = (sequence: number, title: string): RoadmapLiveState => ({
  snapshotSequence: sequence,
  sequence,
  items: [item("a", title)],
  sprints: [],
});

function store(records = new Map<EnvironmentId, string>()) {
  return {
    records,
    service: {
      load: (environmentId: EnvironmentId) =>
        Effect.sync(() => Option.fromUndefinedOr(records.get(environmentId))),
      save: (environmentId: EnvironmentId, payload: string) =>
        Effect.sync(() => {
          records.set(environmentId, payload);
        }),
    },
  };
}

const collect = (live: ReadonlyArray<RoadmapLiveState>, environmentId = home) =>
  withRoadmapCache(environmentId, Stream.fromIterable(live)).pipe(
    Stream.runCollect,
    Effect.map((views) => views.map((view) => [view.source, view.items[0]?.title])),
  );

describe("withRoadmapCache", () => {
  it.effect("shows the cached roadmap until the live one arrives, then caches the live one", () => {
    const cache = store();
    return Effect.gen(function* () {
      expect(yield* collect([state(1, "first visit")])).toEqual([["live", "first visit"]]);
      expect(yield* collect([state(2, "next visit")])).toEqual([
        ["cache", "first visit"],
        ["live", "next visit"],
      ]);
      expect(yield* collect([])).toEqual([["cache", "next visit"]]);
    }).pipe(Effect.provideService(RoadmapCacheStore, cache.service));
  });

  it.effect("keeps each environment's roadmap apart", () => {
    const cache = store();
    return Effect.gen(function* () {
      yield* collect([state(1, "home roadmap")]);
      expect(yield* collect([], other)).toEqual([]);
    }).pipe(Effect.provideService(RoadmapCacheStore, cache.service));
  });

  it.effect("ignores a corrupt or incompatible cache", () =>
    Effect.gen(function* () {
      expect(yield* collect([state(3, "live")])).toEqual([["live", "live"]]);
    }).pipe(
      Effect.provideService(
        RoadmapCacheStore,
        store(new Map([[home, '{"schemaVersion":0}']])).service,
      ),
    ),
  );

  it.effect("keeps streaming when the cache cannot be written", () =>
    Effect.gen(function* () {
      expect(yield* collect([state(1, "one"), state(2, "two")])).toEqual([
        ["live", "one"],
        ["live", "two"],
      ]);
    }).pipe(
      Effect.provideService(RoadmapCacheStore, {
        load: () => Effect.succeedNone,
        save: () => Effect.die("quota exceeded"),
      }),
    ),
  );

  it.effect("passes the live roadmap through on platforms without a cache", () =>
    Effect.gen(function* () {
      expect(yield* collect([state(1, "live")])).toEqual([["live", "live"]]);
    }),
  );
});
