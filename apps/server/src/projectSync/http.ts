import {
  AuthAccessWriteScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentHttpApi,
  type ProjectSyncRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { annotateEnvironmentRequest, requireEnvironmentScope } from "../auth/http.ts";
import { ProjectSyncService } from "./Service.ts";

export const executeProjectSyncRequest = Effect.fn("environment.projectSync.execute")(function* (
  request: ProjectSyncRequest,
) {
  yield* requireEnvironmentScope(
    request.operation === "status"
      ? AuthOrchestrationReadScope
      : request.operation === "continue"
        ? AuthOrchestrationOperateScope
        : AuthAccessWriteScope,
  );
  const sync = yield* ProjectSyncService;
  return yield* sync.execute(request);
});

export const projectSyncHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "projectSync",
  Effect.fnUntraced(function* (handlers) {
    const sync = yield* ProjectSyncService;
    return handlers.handle(
      "execute",
      Effect.fn("environment.projectSync.http")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        return yield* executeProjectSyncRequest(args.payload.request).pipe(
          Effect.provideService(ProjectSyncService, sync),
        );
      }),
    );
  }),
);
