/**
 * Fork: the roadmap's one write path and its reads. The RPC, MCP tools and
 * turn context all call this service, so the home check, idempotency and the
 * live stream behave the same for users and agents. Off the home, a linked
 * environment forwards reads to the home and queues writes for it.
 */
import {
  isRoadmapSprintCommand,
  type RoadmapActor,
  type RoadmapCommand,
  type RoadmapDispatchResult,
  RoadmapError,
  type RoadmapItemId,
  type RoadmapLinkConfigureInput,
  type RoadmapLinkError,
  type RoadmapLinkItem,
  type RoadmapLinkSnapshot,
  type RoadmapLinkStatus,
  type RoadmapSprint,
  type RoadmapStreamItem,
  type RoadmapSubmitResult,
  type RoadmapThreadContext,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
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
import { planRoadmapCommand, type RoadmapItemRecord } from "./RoadmapCommands.ts";
import { renderRoadmapContext } from "./RoadmapContextBlock.ts";
import * as RoadmapLink from "./RoadmapLink.ts";
import * as RoadmapLinkOutbox from "./RoadmapLinkOutbox.ts";
import * as RoadmapProgress from "./RoadmapProgress.ts";
import * as RoadmapStore from "./RoadmapStore.ts";

/** Enough for an agent to see what changed lately without carrying an item's whole life. */
const ITEM_HISTORY_LIMIT = 20;

/**
 * How long a write off the home waits for the home's answer before it reports
 * itself queued. Long enough for a reachable home, so an agent learns of a
 * refusal; short enough that a slow home does not stall the tool call.
 */
const SUBMIT_WAIT = Duration.seconds(5);

/** Where this environment's roadmap reads and writes go. */
export type RoadmapLocation = "home" | "linked" | "not-linked";

export class RoadmapService extends Context.Service<
  RoadmapService,
  {
    /** Whether this environment owns the roadmap; only the home accepts commands. */
    readonly isHome: Effect.Effect<boolean, RoadmapError>;
    readonly location: Effect.Effect<RoadmapLocation, RoadmapError>;
    /**
     * Applies a command on the home; refuses anywhere else. A repeated
     * `commandId` returns its first outcome without writing again.
     */
    readonly dispatch: (
      command: RoadmapCommand,
      actor: RoadmapActor,
    ) => Effect.Effect<RoadmapDispatchResult, RoadmapError>;
    /**
     * Applies a command on the home, or off it queues the command for the home
     * and reports it applied if the home answers within a few seconds.
     */
    readonly submit: (
      command: RoadmapCommand,
      actor: RoadmapActor,
    ) => Effect.Effect<RoadmapSubmitResult, RoadmapError>;
    readonly linkStatus: Effect.Effect<RoadmapLinkStatus, RoadmapError>;
    /** Links this environment to the home, or unlinks it with null; answers the new status. */
    readonly configureLink: (
      link: RoadmapLinkConfigureInput["link"],
    ) => Effect.Effect<RoadmapLinkStatus, RoadmapLinkError | RoadmapError>;
    /** Live items, ordered by parent then sibling order. */
    readonly list: () => Effect.Effect<ReadonlyArray<RoadmapWorkItem>, RoadmapError>;
    /** Sprints, ordered by start date. */
    readonly listSprints: () => Effect.Effect<ReadonlyArray<RoadmapSprint>, RoadmapError>;
    /**
     * Every item in this environment's own tables, deleted ones included, never
     * forwarded. GitHub sync, which runs on the home only, reads it.
     */
    readonly localRecords: () => Effect.Effect<ReadonlyArray<RoadmapItemRecord>, RoadmapError>;
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
    /**
     * This environment's own roadmap: a snapshot, then a delta per changed item
     * or sprint after every later commit. Clients subscribe on the home.
     */
    readonly stream: () => Stream.Stream<RoadmapStreamItem, RoadmapError>;
  }
>()("lathe/fork/roadmap/RoadmapService") {}

const internal = (message: string) => () => new RoadmapError({ code: "internal", message });
const readFailed = internal("Could not read the roadmap.");
const writeFailed = internal("Could not save the roadmap change.");

const notLinked = new RoadmapError({
  code: "roadmap_home_elsewhere",
  message: "The roadmap lives on another environment, and this one is not linked to it.",
});

/** The home not answering is a failure worth retrying, like a storage error. */
const fromLink = (error: RoadmapError | RoadmapLink.RoadmapLinkUnavailableError) =>
  error._tag === "RoadmapError"
    ? error
    : error.reason === "not_linked"
      ? notLinked
      : new RoadmapError({ code: "internal", message: error.message });

const commandItemId = (command: RoadmapCommand) =>
  isRoadmapSprintCommand(command) ? null : command.itemId;

const make = Effect.gen(function* () {
  const store = yield* RoadmapStore.RoadmapStore;
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettingsService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const link = yield* RoadmapLink.RoadmapLink;
  const outbox = yield* RoadmapLinkOutbox.RoadmapLinkOutbox;
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
        // Fork: roadmap. Only the steward's re-tick rule needs the untick time.
        const criterionUntickedAt =
          command.type === "roadmap.criterion.tick" && actor._tag === "steward"
            ? yield* store.history(command.itemId).pipe(
                Effect.map(
                  (events) =>
                    events.findLast(
                      ({ event }) =>
                        event.type === "roadmap.criterion.ticked" &&
                        event.payload.criterionId === command.criterionId &&
                        !event.payload.ticked,
                    )?.event.occurredAt,
                ),
                Effect.mapError(readFailed),
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
            ...(criterionUntickedAt === undefined ? {} : { criterionUntickedAt }),
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

  const location: RoadmapService["Service"]["location"] = Effect.gen(function* () {
    if (yield* isHome) return "home";
    return (yield* link.isLinked) ? "linked" : "not-linked";
  });

  /** The home reads its own tables; a linked environment asks the home. */
  const routed = <A>(
    local: Effect.Effect<A, RoadmapError>,
    remote: Effect.Effect<A, RoadmapError | RoadmapLink.RoadmapLinkUnavailableError>,
  ): Effect.Effect<A, RoadmapError> =>
    location.pipe(
      Effect.flatMap((where) =>
        where === "home"
          ? local
          : where === "linked"
            ? remote.pipe(Effect.mapError(fromLink))
            : Effect.fail(notLinked),
      ),
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

  const localList = store.list().pipe(
    Effect.map((records) => records.map((record) => record.item)),
    Effect.mapError(readFailed),
  );

  const localSnapshot = Effect.all({
    items: localList,
    sprints: store.listSprints().pipe(Effect.mapError(readFailed)),
    areas: settings.getSettings.pipe(
      Effect.map((current) => current.roadmap.areas),
      Effect.mapError(readFailed),
    ),
  });

  const localItem = (itemId: RoadmapItemId) =>
    Effect.all({
      item: store
        .get(itemId)
        .pipe(Effect.map((record) => Option.getOrNull(Option.map(record, (live) => live.item)))),
      history: store
        .history(itemId)
        .pipe(Effect.map((events) => events.slice(-ITEM_HISTORY_LIMIT))),
    }).pipe(Effect.mapError(readFailed));

  const localForThread = (thread: RoadmapThreadRef) =>
    store.forThread(thread).pipe(Effect.mapError(readFailed));

  const localThreadContext = (thread: RoadmapThreadRef) =>
    Effect.gen(function* () {
      const items = yield* localForThread(thread);
      // A thread is attached to one item at a time; see `already_attached`.
      const [attached] = items;
      if (attached === undefined) return { items, context: "" };
      const current = yield* localSnapshot;
      const { byId, progressOf } = RoadmapProgress.progressCalculator({
        ...current,
        today: yield* RoadmapProgress.todayUtc,
      });
      return { items, context: renderRoadmapContext(attached, byId, progressOf(attached)) };
    });

  const snapshot: RoadmapService["Service"]["snapshot"] = () =>
    routed(localSnapshot, link.snapshot);

  const item: RoadmapService["Service"]["item"] = (itemId) =>
    routed(localItem(itemId), link.item(itemId));

  const threadContext: RoadmapService["Service"]["threadContext"] = (thread) =>
    routed(localThreadContext(thread), link.threadContext(thread));

  const forThread: RoadmapService["Service"]["forThread"] = (thread) =>
    routed(
      localForThread(thread),
      link.threadContext(thread).pipe(Effect.map((context) => context.items)),
    );

  const submit: RoadmapService["Service"]["submit"] = (command, actor) =>
    Effect.gen(function* () {
      const where = yield* location;
      if (where === "home") {
        return { queued: false, ...(yield* dispatch(command, actor)) } as const;
      }
      if (where === "not-linked") return yield* notLinked;
      // While the home is known to be down, waiting would only stall the agent.
      const { unreachableSince } = yield* link.status;
      const outcome = yield* outbox.submit(
        command,
        actor,
        unreachableSince === null ? SUBMIT_WAIT : Duration.zero,
      );
      if (outcome._tag === "rejected") return yield* outcome.error;
      return outcome._tag === "accepted"
        ? ({ queued: false, ...outcome.result } as const)
        : ({ queued: true, itemId: commandItemId(command) } as const);
    });

  const linkStatus: RoadmapService["Service"]["linkStatus"] = Effect.gen(function* () {
    const { homeUrl, unreachableSince } = yield* link.status;
    const { queued, rejected } = yield* outbox.counts;
    return {
      state: homeUrl === null ? "not-linked" : unreachableSince === null ? "linked" : "unreachable",
      homeUrl,
      unreachableSince,
      queued,
      rejected,
    } as const;
  });

  const configureLink: RoadmapService["Service"]["configureLink"] = (next) =>
    // The worker idles while unlinked; a new link may have writes waiting.
    link.configure(next).pipe(Effect.andThen(outbox.wake), Effect.andThen(linkStatus));

  return RoadmapService.of({
    isHome,
    location,
    dispatch,
    submit,
    linkStatus,
    configureLink,
    list: () => snapshot().pipe(Effect.map((current) => current.items)),
    listSprints: () => snapshot().pipe(Effect.map((current) => current.sprints)),
    localRecords: () => store.list({ includeDeleted: true }).pipe(Effect.mapError(readFailed)),
    get: (itemId) => item(itemId).pipe(Effect.map((read) => Option.fromNullOr(read.item))),
    forThread,
    snapshot,
    item,
    threadContext,
    stream,
  });
});

/**
 * The outbox comes out with the service, so the server runs its worker on the
 * same instance: the outbox holds the waiters `submit` answers.
 */
export const layer = Layer.effect(RoadmapService, make).pipe(
  Layer.provide(RoadmapStore.layer),
  Layer.provideMerge(RoadmapLinkOutbox.layer),
);
