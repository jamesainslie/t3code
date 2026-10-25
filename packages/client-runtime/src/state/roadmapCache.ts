/**
 * Fork: roadmap. The last roadmap each client saw, so the page can show it
 * while the home is still connecting instead of waiting on the network.
 */
import { EnvironmentId, RoadmapSprint, RoadmapWorkItem } from "@lathe/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import type { RoadmapLiveState } from "../roadmap/roadmapTree.ts";

/** Platforms without one, such as mobile, never show a cached roadmap. */
export class RoadmapCacheStore extends Context.Reference<{
  readonly load: (environmentId: EnvironmentId) => Effect.Effect<Option.Option<string>>;
  readonly save: (environmentId: EnvironmentId, payload: string) => Effect.Effect<void>;
} | null>("@lathe/client-runtime/RoadmapCacheStore", {
  defaultValue: () => null,
}) {}

export interface RoadmapLiveView extends RoadmapLiveState {
  /** "cache" until the home's own snapshot arrives; a cached roadmap may be stale. */
  readonly source: "cache" | "live";
}

const CachedRoadmap = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({
      schemaVersion: Schema.Literal(1),
      environmentId: EnvironmentId,
      snapshotSequence: Schema.Number,
      sequence: Schema.Number,
      items: Schema.Array(RoadmapWorkItem),
      sprints: Schema.Array(RoadmapSprint),
    }),
  ),
);
const decodeCachedRoadmap = Schema.decodeUnknownEffect(CachedRoadmap);
const encodeCachedRoadmap = Schema.encodeEffect(CachedRoadmap);

const loadCachedRoadmap = Effect.fn("RoadmapCache.load")(function* (environmentId: EnvironmentId) {
  const store = yield* RoadmapCacheStore;
  if (store === null) return Option.none<RoadmapLiveView>();
  const stored = yield* store.load(environmentId);
  if (Option.isNone(stored)) return Option.none<RoadmapLiveView>();
  return yield* decodeCachedRoadmap(stored.value).pipe(
    Effect.map(({ environmentId: owner, snapshotSequence, sequence, items, sprints }) =>
      owner === environmentId
        ? Option.some<RoadmapLiveView>({
            snapshotSequence,
            sequence,
            items,
            sprints,
            source: "cache",
          })
        : Option.none<RoadmapLiveView>(),
    ),
    // A cache written by another version is only a slower first paint.
    Effect.catch(() => Effect.succeedNone),
  );
});

const saveCachedRoadmap = Effect.fn("RoadmapCache.save")(
  function* (environmentId: EnvironmentId, state: RoadmapLiveState) {
    const store = yield* RoadmapCacheStore;
    if (store === null) return;
    const payload = yield* encodeCachedRoadmap({
      schemaVersion: 1,
      environmentId,
      snapshotSequence: state.snapshotSequence,
      sequence: state.sequence,
      items: state.items,
      sprints: state.sprints,
    });
    yield* store.save(environmentId, payload);
  },
  Effect.catchCause(() => Effect.logWarning("Could not cache the roadmap.")),
);

/** The cached roadmap, if any, then each live state, which also replaces the cache. */
export const withRoadmapCache = <E, R>(
  environmentId: EnvironmentId,
  live: Stream.Stream<RoadmapLiveState, E, R>,
): Stream.Stream<RoadmapLiveView, E, R> =>
  Stream.concat(
    Stream.fromEffect(loadCachedRoadmap(environmentId)).pipe(
      Stream.flatMap(Option.match({ onNone: () => Stream.empty, onSome: Stream.succeed })),
    ),
    live.pipe(
      Stream.tap((state) => saveCachedRoadmap(environmentId, state)),
      Stream.map((state): RoadmapLiveView => ({ ...state, source: "live" })),
    ),
  );
