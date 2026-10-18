/**
 * Fork: roadmap writes waiting to reach the roadmap home, in the order they
 * were made. One worker sends the oldest pending row and nothing behind it,
 * so the home applies them in order. A transport failure leaves the row at
 * the head and retries it forever with a capped backoff; a refusal from the
 * home ends that row alone. A resend after a lost answer is harmless, because
 * the home's command receipts replay the first outcome.
 */
import {
  type RoadmapActor,
  RoadmapActor as RoadmapActorSchema,
  type RoadmapCommand,
  RoadmapCommand as RoadmapCommandSchema,
  type RoadmapDispatchResult,
  RoadmapError,
} from "@lathe/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

import * as RoadmapLink from "./RoadmapLink.ts";

export type RoadmapLinkOutcome =
  | { readonly _tag: "accepted"; readonly result: RoadmapDispatchResult }
  | { readonly _tag: "rejected"; readonly error: RoadmapError };

/** What one step of the worker did. */
export type RoadmapLinkStep = "sent" | "rejected" | "retry" | "idle" | "unlinked";

export class RoadmapLinkOutbox extends Context.Service<
  RoadmapLinkOutbox,
  {
    /**
     * Queues the command behind every earlier one and wakes the worker. A
     * command already queued is not queued twice.
     */
    readonly enqueue: (
      command: RoadmapCommand,
      actor: RoadmapActor,
    ) => Effect.Effect<void, RoadmapError>;
    /**
     * Queues the command and waits up to `wait` for the home's answer. A command
     * the home already refused answers with that refusal at once.
     */
    readonly submit: (
      command: RoadmapCommand,
      actor: RoadmapActor,
      wait: Duration.Input,
    ) => Effect.Effect<RoadmapLinkOutcome | { readonly _tag: "queued" }, RoadmapError>;
    readonly counts: Effect.Effect<
      { readonly queued: number; readonly rejected: number },
      RoadmapError
    >;
    /** Sends the oldest pending row, if the link is set and there is one. */
    readonly runOnce: Effect.Effect<RoadmapLinkStep>;
    readonly wake: Effect.Effect<void>;
    readonly awaitWork: Effect.Effect<void>;
  }
>()("lathe/fork/roadmap/RoadmapLinkOutbox") {}

// The home answers these when it may answer differently later: a storage
// failure, or a home setting that was changed and may be changed back.
const RETRYABLE_CODES: ReadonlySet<RoadmapError["code"]> = new Set([
  "internal",
  "roadmap_home_elsewhere",
]);

const RETRY_BASE = Duration.seconds(1);
const RETRY_CAP = Duration.minutes(1);

/** The wait before the next try after `failures` failed tries in a row. */
export const retryDelay = (failures: number): Duration.Duration =>
  Duration.min(Duration.times(RETRY_BASE, 2 ** Math.min(failures, 16)), RETRY_CAP);

const PendingRow = Schema.Struct({
  rowId: Schema.Number,
  commandId: Schema.String,
  command: Schema.fromJsonString(Schema.Unknown),
  actor: Schema.fromJsonString(Schema.Unknown),
});

const ExistingRow = Schema.Struct({
  status: Schema.Literals(["pending", "rejected"]),
  error: Schema.NullOr(Schema.fromJsonString(RoadmapError)),
});

const decodeCommand = Schema.decodeUnknownEffect(RoadmapCommandSchema);
const decodeActor = Schema.decodeUnknownEffect(RoadmapActorSchema);
const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(RoadmapCommandSchema));
const encodeActor = Schema.encodeEffect(Schema.fromJsonString(RoadmapActorSchema));
const encodeError = Schema.encodeEffect(Schema.fromJsonString(RoadmapError));

const queueFailed = (cause: unknown) =>
  Effect.logWarning("Roadmap link queue failed", { cause }).pipe(
    Effect.andThen(
      Effect.fail(
        new RoadmapError({ code: "internal", message: "Could not queue the roadmap change." }),
      ),
    ),
  );

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const link = yield* RoadmapLink.RoadmapLink;
  // One pending signal is enough: the worker reads the table, not the signal.
  const signal = yield* Queue.dropping<void>(1);
  const outcomes = new Map<string, Deferred.Deferred<RoadmapLinkOutcome>>();

  const wake = Queue.offer(signal, undefined).pipe(Effect.asVoid);

  const selectHead = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: PendingRow,
    execute: () => sql`
      SELECT row_id AS "rowId", command_id AS "commandId",
        command_json AS "command", actor_json AS "actor"
      FROM roadmap_link_outbox
      WHERE status = 'pending'
      ORDER BY row_id ASC
      LIMIT 1
    `,
  });

  const selectExisting = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: ExistingRow,
    execute: (commandId) => sql`
      SELECT status, error_json AS "error"
      FROM roadmap_link_outbox
      WHERE command_id = ${commandId}
    `,
  });

  const settle = (commandId: string, outcome: RoadmapLinkOutcome) =>
    Effect.suspend(() => {
      const waiting = outcomes.get(commandId);
      outcomes.delete(commandId);
      return waiting === undefined ? Effect.void : Deferred.succeed(waiting, outcome);
    });

  /** The recorded refusal, when the home already refused this command. */
  const insert = (command: RoadmapCommand, actor: RoadmapActor) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        INSERT INTO roadmap_link_outbox (
          command_id, command_json, actor_json, status, enqueued_at
        ) VALUES (
          ${command.commandId},
          ${yield* encodeCommand(command)},
          ${yield* encodeActor(actor)},
          'pending',
          ${now}
        )
        ON CONFLICT (command_id) DO NOTHING
      `;
      const existing = yield* selectExisting(command.commandId);
      return Option.flatMap(existing, (row) =>
        row.status === "rejected" && row.error !== null ? Option.some(row.error) : Option.none(),
      );
    }).pipe(Effect.catch(queueFailed));

  const enqueue: RoadmapLinkOutbox["Service"]["enqueue"] = (command, actor) =>
    insert(command, actor).pipe(Effect.andThen(wake));

  const submit: RoadmapLinkOutbox["Service"]["submit"] = (command, actor, wait) =>
    Effect.gen(function* () {
      // Registered before the insert, so a worker that answers first still finds it.
      const waiting = outcomes.get(command.commandId) ?? Deferred.makeUnsafe<RoadmapLinkOutcome>();
      outcomes.set(command.commandId, waiting);
      const refused = yield* insert(command, actor).pipe(
        Effect.tapError(() => Effect.sync(() => outcomes.delete(command.commandId))),
      );
      if (Option.isSome(refused)) {
        outcomes.delete(command.commandId);
        return { _tag: "rejected", error: refused.value } as const;
      }
      yield* wake;
      const answered = yield* Deferred.await(waiting).pipe(Effect.timeoutOption(wait));
      return Option.getOrElse(answered, () => ({ _tag: "queued" }) as const);
    });

  const counts: RoadmapLinkOutbox["Service"]["counts"] = sql<{
    readonly status: string;
    readonly count: number;
  }>`
    SELECT status, COUNT(*) AS count FROM roadmap_link_outbox GROUP BY status
  `.pipe(
    Effect.map((rows) => ({
      queued: rows.find((row) => row.status === "pending")?.count ?? 0,
      rejected: rows.find((row) => row.status === "rejected")?.count ?? 0,
    })),
    Effect.catch(queueFailed),
  );

  const recordAttempt = (rowId: number) =>
    DateTime.now.pipe(
      Effect.flatMap(
        (now) => sql`
          UPDATE roadmap_link_outbox
          SET attempts = attempts + 1, last_attempt_at = ${DateTime.formatIso(now)}
          WHERE row_id = ${rowId}
        `,
      ),
    );

  const reject = (row: typeof PendingRow.Type, error: RoadmapError) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE roadmap_link_outbox
        SET status = 'rejected', error_json = ${yield* encodeError(error)}
        WHERE row_id = ${row.rowId}
      `;
      yield* settle(row.commandId, { _tag: "rejected", error });
      return "rejected" as const;
    });

  const runOnce: RoadmapLinkOutbox["Service"]["runOnce"] = Effect.gen(function* () {
    if (!(yield* link.isLinked)) return "unlinked" as const;
    const head = yield* selectHead(undefined);
    if (Option.isNone(head)) return "idle" as const;
    const row = head.value;
    const decoded = yield* Effect.all([decodeCommand(row.command), decodeActor(row.actor)]).pipe(
      Effect.result,
    );
    // A row this build cannot read would block the queue forever.
    if (Result.isFailure(decoded)) {
      return yield* reject(
        row,
        new RoadmapError({ code: "internal", message: "The queued change could not be read." }),
      );
    }
    const [command, actor] = decoded.success;
    yield* recordAttempt(row.rowId);
    const sent = yield* link.dispatch(command, actor).pipe(Effect.result);
    if (Result.isSuccess(sent)) {
      yield* sql`DELETE FROM roadmap_link_outbox WHERE row_id = ${row.rowId}`;
      yield* settle(row.commandId, { _tag: "accepted", result: sent.success });
      return "sent" as const;
    }
    const failure = sent.failure;
    if (failure._tag === "RoadmapError" && !RETRYABLE_CODES.has(failure.code)) {
      return yield* reject(row, failure);
    }
    return "retry" as const;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Roadmap link queue step failed", cause).pipe(Effect.as("retry" as const)),
    ),
  );

  return RoadmapLinkOutbox.of({
    enqueue,
    submit,
    counts,
    runOnce,
    wake,
    awaitWork: Queue.take(signal),
  });
});

export const layer = Layer.effect(RoadmapLinkOutbox, make);

/**
 * Runs the queue for the life of the server. It waits for work or a link
 * change while idle, and between failed tries waits out the backoff unless
 * new work wakes it first.
 */
export const runWorker = Effect.gen(function* () {
  const outbox = yield* RoadmapLinkOutbox;
  let failures = 0;
  while (true) {
    const step = yield* outbox.runOnce;
    if (step === "sent" || step === "rejected") {
      failures = 0;
      continue;
    }
    if (step === "retry") {
      const delay = retryDelay(failures);
      failures += 1;
      yield* outbox.awaitWork.pipe(
        Effect.timeoutOrElse({ duration: delay, orElse: () => Effect.void }),
      );
      continue;
    }
    failures = 0;
    yield* outbox.awaitWork;
  }
});

export const layerWorker = Layer.effectDiscard(runWorker.pipe(Effect.forkScoped));
