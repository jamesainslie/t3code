/**
 * Fork: an in-process roadmap home for link tests. It runs the real auth, the
 * real roadmap service and the real HTTP groups behind a `fetch` the linked
 * side's HTTP client calls, so tests cross the same wire a second server would.
 */
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi, type EnvironmentId } from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Etag from "effect/http/Etag";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as TestClock from "effect/testing/TestClock";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as AuthHttp from "../../auth/http.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as RoadmapHttp from "./http.ts";
import * as RoadmapService from "./RoadmapService.ts";

class HomeTestApi extends HttpApi.make("environment")
  .add(EnvironmentHttpApi.groups.roadmap)
  .add(EnvironmentHttpApi.groups.auth) {}

export const HOME_URL = "http://home.test/";

/**
 * The home's handler runs on its own runtime and the real clock, so a
 * credential the test issues must be dated by the real clock too; under the
 * test clock it would be issued in 1970 and read there as long expired.
 */
export const issueOnLiveClock = TestClock.withLive;

/** A secret store that keeps everything in memory, readable by the test. */
export const makeMemorySecretStore = (initial: Record<string, string> = {}) => {
  const values = new Map<string, Uint8Array>(
    Object.entries(initial).map(([name, value]) => [name, new TextEncoder().encode(value)]),
  );
  const store = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: (name, bytes) =>
      Effect.sync(() => {
        const existing = values.get(name);
        if (existing !== undefined) return existing;
        const created = crypto.getRandomValues(new Uint8Array(bytes));
        values.set(name, created);
        return created;
      }),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
  const read = (name: string) => {
    const value = values.get(name);
    return value === undefined ? undefined : new TextDecoder().decode(value);
  };
  return { store, read };
};

/**
 * A roadmap home. `fetch` serves its HTTP API; `setReachable(false)` makes
 * every call fail as a network error would, and `dropNextResponses(n)` lets
 * the home apply the next `n` calls but loses their responses.
 */
export const makeInProcessHome = Effect.fn("makeInProcessHome")(function* (
  options: { readonly homeEnvironmentId?: EnvironmentId | null } = {},
) {
  const services = yield* Layer.build(
    Layer.mergeAll(
      EnvironmentAuth.layer.pipe(Layer.provide(ServerEnvironment.layerIdentity)),
      RoadmapService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            IdAllocator.layer,
            ServerSettingsService.layerTest({
              roadmap: { homeEnvironmentId: options.homeEnvironmentId ?? null },
            }),
            ServerEnvironment.layerIdentity,
          ),
        ),
      ),
    ).pipe(
      Layer.provideMerge(SqlitePersistence.layerMemory),
      // The token endpoint also reads these per request, for DPoP proofs.
      Layer.provideMerge(ServerSecretStore.layer),
      Layer.provideMerge(NodeCrypto.layer),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "lathe-roadmap-home-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  const routes = HttpApiBuilder.layer(HomeTestApi).pipe(
    Layer.provide(RoadmapHttp.layer),
    Layer.provide(RoadmapHttp.layerRoadmapLinkAuth),
    Layer.provide(AuthHttp.layer),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
    Layer.provide(Layer.succeedContext(services)),
    HttpRouter.provideRequest(Layer.succeedContext(services)),
    Layer.provide(HttpPlatform.layer),
    Layer.provide(Etag.layerWeak),
    Layer.provide(NodeServices.layer),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  let reachable = true;
  let dropResponses = 0;
  const paths: Array<string> = [];
  const fetch = (async (...[input, init]: Parameters<typeof globalThis.fetch>) => {
    const request = new Request(input, init);
    paths.push(new URL(request.url).pathname);
    if (!reachable) throw new TypeError("fetch failed");
    const response = await handler(request);
    if (dropResponses > 0) {
      dropResponses -= 1;
      throw new TypeError("socket hang up");
    }
    return response;
  }) as typeof globalThis.fetch;

  const auth = Context.get(services, EnvironmentAuth.EnvironmentAuth);
  return {
    auth,
    roadmap: Context.get(services, RoadmapService.RoadmapService),
    handler,
    fetch,
    /** The path of every call the home received, reachable or not. */
    paths,
    setReachable: (next: boolean) => {
      reachable = next;
    },
    dropNextResponses: (count: number) => {
      dropResponses = count;
    },
    linkGrant: (environmentId: EnvironmentId) =>
      issueOnLiveClock(
        auth.issueRoadmapLinkGrant({ environmentId }).pipe(Effect.map((grant) => grant.credential)),
      ),
  };
});

export type InProcessHome = Effect.Success<ReturnType<typeof makeInProcessHome>>;

/** The HTTP client a linked environment uses, wired to the in-process home. */
export const layerHttpClientTo = (home: InProcessHome) =>
  FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, home.fetch)));
