// Orchestration WS RPC handlers.

import { Effect, Option, Schema, Stream } from "effect";
import { clamp } from "effect/Number";
import {
  CommandId,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  OrchestrationReplayEventsError,
  ORCHESTRATION_WS_METHODS,
} from "@t3tools/contracts";

import {
  observeRpcEffect,
  observeRpcStreamEffect,
} from "../../observability/RpcInstrumentation.ts";
import { normalizeDispatchCommand } from "../../orchestration/Normalizer.ts";
import type { WsMethodRegistry } from "../wsMethodRegistry.ts";
import { isThreadDetailEvent, type HandlerDeps } from "./shared.ts";

export function orchestrationHandlers(deps: HandlerDeps) {
  const {
    checkpointDiffQuery,
    orchestrationEngine,
    projectionSnapshotQuery,
    terminalManager,
    helpers,
  } = deps;
  const { dispatchNormalizedCommand, enrichOrchestrationEvents, toShellStreamEvent } = helpers;

  return {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.dispatchCommand,
        Effect.gen(function* () {
          const normalizedCommand = yield* normalizeDispatchCommand(command);
          const shouldStopSessionAfterArchive =
            normalizedCommand.type === "thread.archive"
              ? yield* projectionSnapshotQuery.getThreadShellById(normalizedCommand.threadId).pipe(
                  Effect.map(
                    Option.match({
                      onNone: () => false,
                      onSome: (thread) =>
                        thread.session !== null && thread.session.status !== "stopped",
                    }),
                  ),
                  Effect.catch(() => Effect.succeed(false)),
                )
              : false;
          const result = yield* dispatchNormalizedCommand(normalizedCommand);
          if (normalizedCommand.type === "thread.archive") {
            if (shouldStopSessionAfterArchive) {
              yield* Effect.gen(function* () {
                const stopCommand = yield* normalizeDispatchCommand({
                  type: "thread.session.stop",
                  commandId: CommandId.make(
                    `session-stop-for-archive:${normalizedCommand.commandId}`,
                  ),
                  threadId: normalizedCommand.threadId,
                  createdAt: new Date().toISOString(),
                });

                yield* dispatchNormalizedCommand(stopCommand);
              }).pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to stop provider session during archive", {
                    threadId: normalizedCommand.threadId,
                    cause,
                  }),
                ),
              );
            }

            yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
              Effect.catch((error) =>
                Effect.logWarning("failed to close thread terminals after archive", {
                  threadId: normalizedCommand.threadId,
                  error: error.message,
                }),
              ),
            );
          }
          return result;
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(OrchestrationDispatchCommandError)(cause)
              ? cause
              : new OrchestrationDispatchCommandError({
                  message: "Failed to dispatch orchestration command",
                  cause,
                }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getTurnDiff,
        checkpointDiffQuery.getTurnDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetTurnDiffError({
                message: "Failed to load turn diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.getFullThreadDiff,
        checkpointDiffQuery.getFullThreadDiff(input).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationGetFullThreadDiffError({
                message: "Failed to load full thread diff",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
      observeRpcEffect(
        ORCHESTRATION_WS_METHODS.replayEvents,
        Stream.runCollect(
          orchestrationEngine.readEvents(
            clamp(input.fromSequenceExclusive, {
              maximum: Number.MAX_SAFE_INTEGER,
              minimum: 0,
            }),
          ),
        ).pipe(
          Effect.map((events) => Array.from(events)),
          Effect.flatMap(enrichOrchestrationEvents),
          Effect.mapError(
            (cause) =>
              new OrchestrationReplayEventsError({
                message: "Failed to replay orchestration events",
                cause,
              }),
          ),
        ),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeShell]: (_input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeShell,
        Effect.gen(function* () {
          const snapshot = yield* projectionSnapshotQuery.getShellSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration shell snapshot",
                  cause,
                }),
            ),
          );

          const liveStream = orchestrationEngine.streamDomainEvents.pipe(
            Stream.mapEffect(toShellStreamEvent),
            Stream.flatMap((event) =>
              Option.isSome(event) ? Stream.succeed(event.value) : Stream.empty,
            ),
          );

          return Stream.concat(
            Stream.make({
              kind: "snapshot" as const,
              snapshot,
            }),
            liveStream,
          );
        }),
        { "rpc.aggregate": "orchestration" },
      ),
    [ORCHESTRATION_WS_METHODS.subscribeThread]: (input) =>
      observeRpcStreamEffect(
        ORCHESTRATION_WS_METHODS.subscribeThread,
        Effect.gen(function* () {
          const [threadDetail, snapshotSequence] = yield* Effect.all([
            projectionSnapshotQuery.getThreadDetailById(input.threadId).pipe(
              Effect.mapError(
                (cause) =>
                  new OrchestrationGetSnapshotError({
                    message: `Failed to load thread ${input.threadId}`,
                    cause,
                  }),
              ),
            ),
            orchestrationEngine
              .getReadModel()
              .pipe(Effect.map((readModel) => readModel.snapshotSequence)),
          ]);

          if (Option.isNone(threadDetail)) {
            return yield* new OrchestrationGetSnapshotError({
              message: `Thread ${input.threadId} was not found`,
              cause: input.threadId,
            });
          }

          const liveStream = orchestrationEngine.streamDomainEvents.pipe(
            Stream.filter(
              (event) =>
                event.aggregateKind === "thread" &&
                event.aggregateId === input.threadId &&
                isThreadDetailEvent(event),
            ),
            Stream.map((event) => ({
              kind: "event" as const,
              event,
            })),
          );

          return Stream.concat(
            Stream.make({
              kind: "snapshot" as const,
              snapshot: {
                snapshotSequence,
                thread: threadDetail.value,
              },
            }),
            liveStream,
          );
        }),
        { "rpc.aggregate": "orchestration" },
      ),
  } satisfies WsMethodRegistry;
}
