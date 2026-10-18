/**
 * Fork: the roadmap block an attached thread's agent sees at the start of
 * every turn. It rides in the provider-bound text, so it reaches every adapter
 * the same way and never lands in the stored user message.
 */
import type { ThreadId } from "@lathe/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as RoadmapService from "./RoadmapService.ts";

// Off the home the block comes over the network, and a turn waits for it, so
// a slow home costs at most this before the agent starts with the last copy.
const HOME_WAIT = Duration.seconds(3);

// One block per thread that ran a turn while linked; old threads fall out first.
const CACHE_LIMIT = 500;

const staleMarker = (fetchedAt: string) =>
  `Possibly out of date: the roadmap home could not be reached, so this is the copy from ${fetchedAt}.`;

export class RoadmapTurnContext extends Context.Service<
  RoadmapTurnContext,
  {
    /**
     * The block for the thread's work item, or "" when it has none or the
     * roadmap cannot be read. Off the home, when the home does not answer, the
     * last block the home gave for the thread, marked possibly out of date.
     * Never fails, so a roadmap problem can never stop a turn.
     */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<string>;
  }
>()("lathe/fork/roadmap/RoadmapTurnContext") {}

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  // In memory: after a restart the first turn needs the home again.
  const lastGood = new Map<ThreadId, { readonly context: string; readonly fetchedAt: string }>();

  const remember = (threadId: ThreadId, context: string) =>
    DateTime.now.pipe(
      Effect.map((now) => {
        lastGood.delete(threadId);
        lastGood.set(threadId, { context, fetchedAt: DateTime.formatIso(now) });
        if (lastGood.size > CACHE_LIMIT) {
          const oldest = lastGood.keys().next();
          if (oldest.done !== true) lastGood.delete(oldest.value);
        }
        return context;
      }),
    );

  const fallBack = (threadId: ThreadId, reason: unknown) => {
    const cached = lastGood.get(threadId);
    return Effect.logWarning("Roadmap context skipped for this turn", { threadId, reason }).pipe(
      Effect.as(
        cached === undefined || cached.context === ""
          ? ""
          : `${staleMarker(cached.fetchedAt)}\n${cached.context}`,
      ),
    );
  };

  return RoadmapTurnContext.of({
    forThread: (threadId) =>
      Effect.gen(function* () {
        const environmentId = yield* identity.getEnvironmentId;
        const { context } = yield* roadmap
          .threadContext({ environmentId, threadId })
          .pipe(Effect.timeout(HOME_WAIT));
        return yield* remember(threadId, context);
      }).pipe(
        Effect.catch((error) =>
          // Unlinked, or the home moved: no block, and no stale copy of one.
          error._tag === "RoadmapError" && error.code === "roadmap_home_elsewhere"
            ? Effect.sync(() => lastGood.delete(threadId)).pipe(Effect.as(""))
            : fallBack(threadId, error),
        ),
        Effect.catchDefect((defect) => fallBack(threadId, defect)),
        Effect.withSpan("RoadmapTurnContext.forThread"),
      ),
  });
});

export const layer = Layer.effect(RoadmapTurnContext, make);
