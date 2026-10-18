/**
 * Fork: the roadmap's one write path and its reads. The RPC, MCP tools and
 * turn context all call this service, so the home check, idempotency and the
 * live stream behave the same for users and agents.
 */
import {
  isRoadmapSprintCommand,
  type RoadmapActor,
  type RoadmapCommand,
  type RoadmapDispatchResult,
  RoadmapError,
  type RoadmapItemId,
  type RoadmapSprint,
  type RoadmapStoredEvent,
  type RoadmapStreamItem,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { planRoadmapCommand } from "./RoadmapCommands.ts";
import * as RoadmapStore from "./RoadmapStore.ts";

export class RoadmapService extends Context.Service<
  RoadmapService,
  {
    /** Whether this environment owns the roadmap; only the home accepts commands. */
    readonly isHome: Effect.Effect<boolean, RoadmapError>;
    /** A repeated `commandId` returns its first outcome without writing again. */
    readonly dispatch: (
      command: RoadmapCommand,
      actor: RoadmapActor,
    ) => Effect.Effect<RoadmapDispatchResult, RoadmapError>;
    /** Live items, ordered by parent then sibling order. */
    readonly list: () => Effect.Effect<ReadonlyArray<RoadmapWorkItem>, RoadmapError>;
    /** Sprints, ordered by start date. */
    readonly listSprints: () => Effect.Effect<ReadonlyArray<RoadmapSprint>, RoadmapError>;
    /** A live item; deleted ones read as none. */
    readonly get: (
      itemId: RoadmapItemId,
    ) => Effect.Effect<Option.Option<RoadmapWorkItem>, RoadmapError>;
    /** Live items the thread is attached to. */
    readonly forThread: (
      thread: RoadmapThreadRef,
    ) => Effect.Effect<ReadonlyArray<RoadmapWorkItem>, RoadmapError>;
    /** The item's events, oldest first. */
    readonly history: (
      itemId: RoadmapItemId,
    ) => Effect.Effect<ReadonlyArray<RoadmapStoredEvent>, RoadmapError>;
    /** A snapshot, then a delta per changed item or sprint after every later commit. */
    readonly stream: () => Stream.Stream<RoadmapStreamItem, RoadmapError>;
  }
>()("lathe/fork/roadmap/RoadmapService") {}

const internal = (message: string) => () => new RoadmapError({ code: "internal", message });
const readFailed = internal("Could not read the roadmap.");
const writeFailed = internal("Could not save the roadmap change.");

const make = Effect.gen(function* () {
  const store = yield* RoadmapStore.RoadmapStore;
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettingsService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const changes = yield* PubSub.unbounded<RoadmapStreamItem>();
  // Roadmap writes are rare and cycle checks read the whole tree, so one lock
  // keeps every plan consistent with what it commits.
  const lock = yield* Semaphore.make(1);

  const isHome: RoadmapService["Service"]["isHome"] = Effect.gen(function* () {
    const current = yield* settings.getSettings.pipe(Effect.mapError(readFailed));
    const home = current.roadmap.homeEnvironmentId;
    return home === null || home === (yield* identity.getEnvironmentId);
  });

  const replay = (receipt: RoadmapStore.RoadmapCommandReceipt) =>
    receipt.status === "accepted" && receipt.resultSequence !== null
      ? Effect.succeed({ sequence: receipt.resultSequence, itemId: receipt.itemId })
      : Effect.fail(
          receipt.error ??
            new RoadmapError({ code: "internal", message: "The command was previously rejected." }),
        );

  const dispatch: RoadmapService["Service"]["dispatch"] = (command, actor) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (!(yield* isHome)) {
          return yield* new RoadmapError({
            code: "roadmap_home_elsewhere",
            message: "The roadmap lives on another environment.",
          });
        }
        const existing = yield* store.receipt(command.commandId).pipe(Effect.mapError(readFailed));
        if (Option.isSome(existing)) return yield* replay(existing.value);

        const records = yield* store
          .list({ includeDeleted: true })
          .pipe(Effect.mapError(readFailed));
        const sprints = yield* store.listSprints().pipe(Effect.mapError(readFailed));
        const lastDeletion =
          command.type === "roadmap.item.restore"
            ? Option.getOrUndefined(
                yield* store.lastDeletion(command.itemId).pipe(Effect.mapError(readFailed)),
              )
            : undefined;
        const now = yield* DateTime.now;
        const eventId = yield* idAllocator.allocate
          .event({ commandId: command.commandId })
          .pipe(Effect.mapError(writeFailed));
        const planned = planRoadmapCommand({
          command,
          actor,
          state: {
            items: new Map(records.map((record) => [record.item.id, record])),
            sprints: new Map(sprints.map((sprint) => [sprint.id, sprint])),
            ...(lastDeletion === undefined ? {} : { lastDeletion }),
          },
          eventId,
          now,
        });
        const acceptedAt = DateTime.formatIso(now);
        const itemId = isRoadmapSprintCommand(command) ? null : command.itemId;

        if (Result.isFailure(planned)) {
          yield* store
            .writeReceipt({
              commandId: command.commandId,
              status: "rejected",
              resultSequence: null,
              itemId,
              error: planned.failure,
              acceptedAt,
            })
            .pipe(Effect.mapError(writeFailed));
          return yield* planned.failure;
        }

        const event = planned.success;
        const { sequence, changed } = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const sequence = yield* store.append(event, command.commandId);
              const changed = yield* store.apply(event, sequence);
              yield* store.writeReceipt({
                commandId: command.commandId,
                status: "accepted",
                resultSequence: sequence,
                itemId,
                error: null,
                acceptedAt,
              });
              return { sequence, changed };
            }),
          )
          .pipe(Effect.mapError(writeFailed));

        for (const change of changed.sprints) {
          yield* PubSub.publish(
            changes,
            change.removed
              ? { type: "sprint.removed", sequence, sprintId: change.sprint.id }
              : { type: "sprint.upserted", sequence, sprint: change.sprint },
          );
        }
        for (const record of changed.items) {
          yield* PubSub.publish(
            changes,
            record.deletedAt === null
              ? { type: "item.upserted", sequence, item: record.item }
              : { type: "item.removed", sequence, itemId: record.item.id },
          );
        }
        return { sequence, itemId };
      }),
    );

  const list: RoadmapService["Service"]["list"] = () =>
    store.list().pipe(
      Effect.map((records) => records.map((record) => record.item)),
      Effect.mapError(readFailed),
    );

  const stream: RoadmapService["Service"]["stream"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the snapshot so a commit in between is not lost; the
        // sequence filter drops whatever the snapshot already holds.
        const subscription = yield* PubSub.subscribe(changes);
        const snapshot = yield* sql
          .withTransaction(
            Effect.all({
              sequence: store.latestSequence(),
              records: store.list(),
              sprints: store.listSprints(),
            }),
          )
          .pipe(Effect.mapError(readFailed));
        return Stream.concat(
          Stream.succeed<RoadmapStreamItem>({
            type: "snapshot",
            sequence: snapshot.sequence,
            items: snapshot.records.map((record) => record.item),
            sprints: snapshot.sprints,
          }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((change) => change.sequence > snapshot.sequence),
          ),
        );
      }),
    );

  return RoadmapService.of({
    isHome,
    dispatch,
    list,
    listSprints: () => store.listSprints().pipe(Effect.mapError(readFailed)),
    get: (itemId) =>
      store
        .get(itemId)
        .pipe(Effect.map(Option.map((record) => record.item)), Effect.mapError(readFailed)),
    forThread: (thread) => store.forThread(thread).pipe(Effect.mapError(readFailed)),
    history: (itemId) => store.history(itemId).pipe(Effect.mapError(readFailed)),
    stream,
  });
});

export const layer = Layer.effect(RoadmapService, make).pipe(Layer.provide(RoadmapStore.layer));
