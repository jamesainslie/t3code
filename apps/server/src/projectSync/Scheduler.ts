import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { ProjectSyncService } from "./Service.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";
export { isSyncDue } from "./scheduleDue.ts";

export const projectSyncSchedulerLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sync = yield* ProjectSyncService;
    const startup = yield* ServerRuntimeStartup;
    yield* Effect.gen(function* () {
      yield* startup.awaitCommandReady;
      yield* sync.execute({ operation: "scheduled" });
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Nightly project sync failed", { message: cause.message }),
      ),
      Effect.repeat(Schedule.spaced(Duration.minutes(1))),
      Effect.forkScoped,
    );
  }),
);
