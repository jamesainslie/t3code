import type { ProjectSyncRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { makeEnvironmentHttpApiUrlBuilder } from "../rpc/http.ts";
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
    group: "projectSync",
    method: "POST",
    timeoutMs: 120_000,
    url: (httpBaseUrl) => makeEnvironmentHttpApiUrlBuilder(httpBaseUrl).projectSync.execute(),
    request: ({ client, headers }) => client.execute({ payload: { request }, headers }),
  });
});
