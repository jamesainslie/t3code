/**
 * Fork: the roadmap block an attached thread's agent sees at the start of
 * every turn. It rides in the provider-bound text, so it reaches every adapter
 * the same way and never lands in the stored user message.
 */
import type { ThreadId } from "@lathe/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as RoadmapService from "./RoadmapService.ts";

export class RoadmapTurnContext extends Context.Service<
  RoadmapTurnContext,
  {
    /**
     * The block for the thread's work item, or "" when it has none, this is not
     * the roadmap home, or the roadmap cannot be read. Never fails, so a
     * roadmap problem can never stop a turn.
     */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<string>;
  }
>()("lathe/fork/roadmap/RoadmapTurnContext") {}

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;

  return RoadmapTurnContext.of({
    forThread: (threadId) =>
      Effect.gen(function* () {
        if (!(yield* roadmap.isHome)) return "";
        const environmentId = yield* identity.getEnvironmentId;
        return (yield* roadmap.threadContext({ environmentId, threadId })).context;
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Roadmap context skipped for this turn", { threadId, error }).pipe(
            Effect.as(""),
          ),
        ),
        Effect.catchDefect((defect) =>
          Effect.logWarning("Roadmap context skipped for this turn", { threadId, defect }).pipe(
            Effect.as(""),
          ),
        ),
        Effect.withSpan("RoadmapTurnContext.forThread"),
      ),
  });
});

export const layer = Layer.effect(RoadmapTurnContext, make);
