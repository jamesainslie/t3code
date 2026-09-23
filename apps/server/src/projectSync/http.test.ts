import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AuthSessionId, EnvironmentAuthenticatedPrincipal } from "@t3tools/contracts";
import { executeProjectSyncRequest } from "./http.ts";
import { ProjectSyncService } from "./Service.ts";

it.effect(
  "rejects import before accessing the source when the session cannot administer this environment",
  () =>
    Effect.gen(function* () {
      let called = false;
      const result = yield* executeProjectSyncRequest({ operation: "syncNow" }).pipe(
        Effect.provideService(EnvironmentAuthenticatedPrincipal, {
          sessionId: AuthSessionId.make("session"),
          subject: "test",
          method: "bearer-access-token",
          scopes: new Set(["orchestration:read", "orchestration:operate"] as const),
        }),
        Effect.provideService(ProjectSyncService, {
          execute: () => {
            called = true;
            return Effect.die("must not execute");
          },
        }),
        Effect.provide(NodeServices.layer),
        Effect.result,
      );
      expect(result._tag).toBe("Failure");
      expect(called).toBe(false);
    }),
);
