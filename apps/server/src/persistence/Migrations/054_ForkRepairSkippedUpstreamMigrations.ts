import * as Effect from "effect/Effect";

import Migration0049 from "./049_ProjectionThreadsActiveOrderKey.ts";
import Migration0050 from "./050_ProjectionThreadPullRequests.ts";

/**
 * Fork-only repair. Fork installs recorded the fork's thread placement
 * migration under ids 49 and 50 before upstream shipped its own 049 and 050.
 * The migrator only runs ids above the highest recorded one, so those
 * databases never created the thread pull request projection. Both upstream
 * migrations are idempotent, so replaying them is a no-op for databases that
 * already ran them and a repair for fork databases that skipped them.
 */
export default Effect.gen(function* () {
  yield* Migration0049;
  yield* Migration0050;
});
