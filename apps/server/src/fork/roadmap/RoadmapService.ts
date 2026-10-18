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
  type RoadmapLinkItem,
  type RoadmapLinkSnapshot,
  type RoadmapSprint,
  type RoadmapStreamItem,
  type RoadmapThreadContext,
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
import { renderRoadmapContext } from "./RoadmapContextBlock.ts";
import * as RoadmapProgress from "./RoadmapProgress.ts";
import * as RoadmapStore from "./RoadmapStore.ts";

/** Enough for an agent to see what changed lately without carrying an item's whole life. */
const ITEM_HISTORY_LIMIT = 20;

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
    /** Items, sprints and each area's settings, read together. */
    readonly snapshot: () => Effect.Effect<RoadmapLinkSnapshot, RoadmapError>;
    /** The item, null when missing or deleted, and its latest events, oldest first. */
    readonly item: (itemId: RoadmapItemId) => Effect.Effect<RoadmapLinkItem, RoadmapError>;
    /** The thread's items and the block its agent sees each turn, "" without an item. */
    readonly threadContext: (
      thread: RoadmapThreadRef,
    ) => Effect.Effect<RoadmapThreadContext, RoadmapError>;
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

  const snapshot: RoadmapService["Service"]["snapshot"] = () =>
    Effect.all({
      items: list(),
      sprints: store.listSprints().pipe(Effect.mapError(readFailed)),
      areas: settings.getSettings.pipe(
        Effect.map((current) => current.roadmap.areas),
        Effect.mapError(readFailed),
      ),
    });

  const item: RoadmapService["Service"]["item"] = (itemId) =>
    Effect.all({
      item: store
        .get(itemId)
        .pipe(Effect.map((record) => Option.getOrNull(Option.map(record, (live) => live.item)))),
      history: store
        .history(itemId)
        .pipe(Effect.map((events) => events.slice(-ITEM_HISTORY_LIMIT))),
    }).pipe(Effect.mapError(readFailed));

  const forThread: RoadmapService["Service"]["forThread"] = (thread) =>
    store.forThread(thread).pipe(Effect.mapError(readFailed));

  const threadContext: RoadmapService["Service"]["threadContext"] = (thread) =>
    Effect.gen(function* () {
      const items = yield* forThread(thread);
      // A thread is attached to one item at a time; see `already_attached`.
      const [attached] = items;
      if (attached === undefined) return { items, context: "" };
      const current = yield* snapshot();
      const { byId, progressOf } = RoadmapProgress.progressCalculator({
        ...current,
        today: yield* RoadmapProgress.todayUtc,
      });
      return { items, context: renderRoadmapContext(attached, byId, progressOf(attached)) };
    });

  return RoadmapService.of({
    isHome,
    dispatch,
    list,
    listSprints: () => store.listSprints().pipe(Effect.mapError(readFailed)),
    get: (itemId) => item(itemId).pipe(Effect.map((read) => Option.fromNullOr(read.item))),
    forThread,
    snapshot,
    item,
    threadContext,
    stream,
  });
});

export const layer = Layer.effect(RoadmapService, make).pipe(Layer.provide(RoadmapStore.layer));
