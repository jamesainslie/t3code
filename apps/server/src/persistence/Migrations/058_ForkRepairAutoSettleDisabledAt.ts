import * as Effect from "effect/Effect";

import Migration0054 from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";

/**
 * Fork-only repair. Upstream shipped its auto-settle column as 054, but fork
 * installs had already recorded the fork's own migrations as 54 through 57.
 * The migrator only runs ids above the highest recorded one, so replay the
 * upstream migration here. It checks for the column first, so databases
 * seeded from an upstream install that already ran it are left alone.
 */
export default Effect.gen(function* () {
  yield* Migration0054;
});
