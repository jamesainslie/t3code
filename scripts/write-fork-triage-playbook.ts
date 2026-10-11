#!/usr/bin/env node
/**
 * Fork-only. Writes the fork's triage playbook from upstream's, so the
 * playbook `lathe triage` fetches matches the one it ships. Run it after an
 * upstream sync changes `.github/triage/PLAYBOOK.md`; a test fails until then.
 *
 *   node scripts/write-fork-triage-playbook.ts
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { FORK_TRIAGE_PLAYBOOK_PATH, forkTriagePlaybook } from "./lib/forkBrand.ts";

const writeForkTriagePlaybook = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const upstream = yield* fs.readFileString(path.join(repoRoot, ".github/triage/PLAYBOOK.md"));
  yield* fs.writeFileString(
    path.join(repoRoot, FORK_TRIAGE_PLAYBOOK_PATH),
    forkTriagePlaybook(upstream),
  );
  yield* Effect.log(`Wrote ${FORK_TRIAGE_PLAYBOOK_PATH}.`);
});

writeForkTriagePlaybook.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
