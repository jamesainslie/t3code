import type { ProjectSyncRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";

export const executeProjectSync = Effect.fn("clientRuntime.state.executeProjectSync")(function* (
  prepared: PreparedConnection,
  request: ProjectSyncRequest,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    method: "POST",
    timeoutMs: 120_000,
    url: (base) => environmentEndpointUrl(base, "/api/project-sync"),
    request: ({ client, headers }) => client.projectSync.execute({ payload: { request }, headers }),
  });
});
