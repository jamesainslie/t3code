import * as OS from "node:os";

import { Effect } from "effect";

import type { RawSample } from "../Services/ResourceSampler.ts";
import { runProcess } from "../../processRunner.ts";

const resolveFqdn: Effect.Effect<string> = Effect.tryPromise({
  try: () => runProcess("hostname", ["-f"], { allowNonZeroExit: true, timeoutMs: 5_000 }),
  catch: () => null,
}).pipe(
  Effect.map((result) => {
    if (!result || result.code !== 0) return null;
    const fqdn = result.stdout.trim();
    return fqdn.length > 0 ? fqdn : null;
  }),
  Effect.orElseSucceed(() => null),
  Effect.map((fqdn) => fqdn ?? OS.hostname()),
);

export const sampleRemote: Effect.Effect<RawSample["remote"]> = Effect.gen(function* () {
  const isRemote = !!(process.env.SSH_CLIENT || process.env.SSH_CONNECTION);
  const hostname = OS.hostname();
  const fqdn = yield* resolveFqdn;
  const isRoot = process.getuid?.() === 0;

  return { isRemote, hostname, fqdn, isRoot };
});
