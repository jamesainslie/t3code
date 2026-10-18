import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  type RoadmapCommand,
  RoadmapItemId,
  type RoadmapStreamItem,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as RoadmapService from "./RoadmapService.ts";

const HOME = EnvironmentId.make("env-home");
const user = { _tag: "user" } as const;

const testLayer = (homeEnvironmentId: EnvironmentId | null) =>
  RoadmapService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        ServerSettingsService.layerTest({ roadmap: { homeEnvironmentId } }),
        Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(HOME),
        }),
      ),
    ),
    Layer.provideMerge(Layer.fresh(SqlitePersistence.layerMemory)),
  );

const create = (itemId: string, commandId = `cmd-${itemId}`): RoadmapCommand => ({
  type: "roadmap.item.create",
  commandId: CommandId.make(commandId),
  itemId: RoadmapItemId.make(itemId),
  itemType: "objective",
  title: `Objective ${itemId}`,
});

const countRows = (table: "roadmap_events" | "roadmap_command_receipts") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count FROM ${sql(table)}
    `;
    return rows[0]!.count;
  });

describe("RoadmapService", () => {
  it.layer(testLayer(null))("on the roadmap home", (it) => {
    it.effect("commits the event, the item and the receipt together", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const result = yield* roadmap.dispatch(create("a"), user);
        assert.equal(result.itemId, "a");
        assert.isAbove(result.sequence, 0);
        const item = Option.getOrThrow(yield* roadmap.get(RoadmapItemId.make("a")));
        assert.equal(item.title, "Objective a");
        assert.equal(yield* countRows("roadmap_events"), 1);
        assert.equal(yield* countRows("roadmap_command_receipts"), 1);
      }),
    );

    it.effect("replays the first result for a repeated command id", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const first = yield* roadmap.dispatch(create("b"), user);
        const events = yield* countRows("roadmap_events");
        const second = yield* roadmap.dispatch(create("b"), user);
        assert.deepEqual(second, first);
        assert.equal(yield* countRows("roadmap_events"), events);
      }),
    );

    it.effect("records a rejection and writes no event", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        const events = yield* countRows("roadmap_events");
        const receipts = yield* countRows("roadmap_command_receipts");
        const orphan: RoadmapCommand = {
          ...create("orphan"),
          parentId: RoadmapItemId.make("missing"),
        } as RoadmapCommand;
        const exit = yield* Effect.exit(roadmap.dispatch(orphan, user));
        assert.isTrue(Exit.isFailure(exit));
        assert.equal(yield* countRows("roadmap_events"), events);
        assert.equal(yield* countRows("roadmap_command_receipts"), receipts + 1);
        const error = yield* Effect.flip(roadmap.dispatch(orphan, user));
        assert.equal(error.code, "not_found");
      }),
    );

    it.effect("streams a snapshot, then later changes only", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        yield* roadmap.dispatch(create("before"), user);
        const subscribed = yield* Deferred.make<void>();
        const seen = yield* roadmap.stream().pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        const after = yield* roadmap.dispatch(create("after"), user);
        const removed = yield* roadmap.dispatch(
          {
            type: "roadmap.item.delete",
            commandId: CommandId.make("cmd-delete-after"),
            itemId: RoadmapItemId.make("after"),
          },
          user,
        );
        const items: ReadonlyArray<RoadmapStreamItem> = yield* Fiber.join(seen);
        const [snapshot, upserted, gone] = items;
        assert.equal(snapshot?.type, "snapshot");
        if (snapshot?.type !== "snapshot") return;
        assert.include(
          snapshot.items.map((item) => item.id),
          RoadmapItemId.make("before"),
        );
        assert.isBelow(snapshot.sequence, after.sequence);
        assert.deepInclude(upserted, { type: "item.upserted", sequence: after.sequence });
        assert.deepEqual(gone, {
          type: "item.removed",
          sequence: removed.sequence,
          itemId: RoadmapItemId.make("after"),
        });
      }),
    );
  });

  it.layer(testLayer(HOME))("when the setting names this environment", (it) => {
    it.effect("accepts commands", () =>
      Effect.gen(function* () {
        const roadmap = yield* RoadmapService.RoadmapService;
        assert.isTrue(yield* roadmap.isHome);
        yield* roadmap.dispatch(create("here"), user);
      }),
    );
  });

  it.layer(testLayer(EnvironmentId.make("env-elsewhere")))(
    "when the roadmap lives on another environment",
    (it) => {
      it.effect("refuses commands with roadmap_home_elsewhere", () =>
        Effect.gen(function* () {
          const roadmap = yield* RoadmapService.RoadmapService;
          assert.isFalse(yield* roadmap.isHome);
          const error = yield* Effect.flip(roadmap.dispatch(create("there"), user));
          assert.equal(error.code, "roadmap_home_elsewhere");
          assert.equal(yield* countRows("roadmap_events"), 0);
        }),
      );
    },
  );
});
