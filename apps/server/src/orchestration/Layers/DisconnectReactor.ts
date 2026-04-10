import { CommandId, ThreadId } from "@t3tools/contracts";
import { Cause, Effect, Layer, Stream } from "effect";

import { WsClientTracker } from "../../wsClientTracker.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { DisconnectReactor, type DisconnectReactorShape } from "../Services/DisconnectReactor.ts";

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const tracker = yield* WsClientTracker;

  const interruptApprovalRequiredTurns = Effect.fn("interruptApprovalRequiredTurns")(function* () {
    const now = new Date().toISOString();
    const readModel = yield* orchestrationEngine.getReadModel();

    const candidates = readModel.threads.filter(
      (thread) =>
        thread.runtimeMode === "approval-required" &&
        thread.latestTurn?.state === "running" &&
        thread.deletedAt === null,
    );

    if (candidates.length === 0) {
      return;
    }

    yield* Effect.logInfo("disconnect reactor: interrupting approval-required turns", {
      count: candidates.length,
      threadIds: candidates.map((t) => t.id),
    });

    yield* Effect.forEach(candidates, (thread) =>
      orchestrationEngine
        .dispatch({
          type: "thread.turn.interrupt",
          commandId: serverCommandId("disconnect-interrupt"),
          threadId: ThreadId.makeUnsafe(thread.id),
          createdAt: now,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("disconnect reactor: failed to interrupt turn", {
              threadId: thread.id,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
    );
  });

  const start: DisconnectReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(Stream.fromPubSub(tracker.allDisconnected), () =>
        interruptApprovalRequiredTurns().pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.failCause(cause);
            }
            return Effect.logWarning(
              "disconnect reactor: failed to process all-clients-disconnected signal",
              { cause: Cause.pretty(cause) },
            );
          }),
        ),
      ),
    );
  });

  return { start } satisfies DisconnectReactorShape;
});

export const DisconnectReactorLive = Layer.effect(DisconnectReactor, make);
