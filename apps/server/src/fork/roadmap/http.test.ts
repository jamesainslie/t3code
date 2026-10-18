import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthRoadmapReadScope,
  CommandId,
  EnvironmentHttpApi,
  EnvironmentId,
  type RoadmapActor,
  type RoadmapCommand,
  RoadmapItemId,
  ThreadId,
} from "@lathe/contracts";
import * as IdAllocator from "@lathe/provider-core/server/IdAllocator";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as RoadmapHttp from "./http.ts";
import * as RoadmapService from "./RoadmapService.ts";

class RoadmapTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.roadmap) {}

const LAPTOP = EnvironmentId.make("env-laptop");
const DESKTOP = EnvironmentId.make("env-desktop");
const agentOn = (environmentId: EnvironmentId): RoadmapActor => ({
  _tag: "agent",
  thread: { environmentId, threadId: ThreadId.make("thread-1") },
  threadTitle: "Fix the build",
});

const create = (itemId: string, fields: Partial<RoadmapCommand> = {}): RoadmapCommand =>
  ({
    type: "roadmap.item.create",
    commandId: CommandId.make(`create-${itemId}`),
    itemId: RoadmapItemId.make(itemId),
    itemType: "story",
    title: `Story ${itemId}`,
    ...fields,
  }) as RoadmapCommand;

const layerServerConfig = ServerConfig.layerTest(process.cwd(), {
  prefix: "lathe-roadmap-http-test-",
});

/** A roadmap home with real auth, the roadmap service and the roadmap HTTP group. */
const makeHome = Effect.fn("makeRoadmapHome")(function* (
  options: { readonly homeEnvironmentId?: EnvironmentId | null } = {},
) {
  const services = yield* Layer.build(
    Layer.mergeAll(
      EnvironmentAuth.layer.pipe(
        Layer.provide(ServerSecretStore.layer),
        Layer.provide(ServerEnvironment.layerIdentity),
      ),
      RoadmapService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            IdAllocator.layer,
            ServerSettingsService.layerTest({
              roadmap: { homeEnvironmentId: options.homeEnvironmentId ?? null },
            }),
            ServerEnvironment.layerIdentity.pipe(Layer.provide(ServerSecretStore.layer)),
          ),
        ),
      ),
    ).pipe(
      Layer.provideMerge(SqlitePersistence.layerMemory),
      Layer.provideMerge(layerServerConfig),
      Layer.provideMerge(NodeServices.layer),
    ),
  );
  const routes = HttpApiBuilder.layer(RoadmapTestApi).pipe(
    Layer.provide(RoadmapHttp.layer),
    Layer.provide(RoadmapHttp.layerRoadmapLinkAuth),
    Layer.provide(Layer.succeedContext(services)),
    Layer.provide(HttpPlatform.layer),
    Layer.provide(Etag.layerWeak),
    Layer.provide(NodeServices.layer),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  const auth = Context.get(services, EnvironmentAuth.EnvironmentAuth);
  const roadmap = Context.get(services, RoadmapService.RoadmapService);
  const linkToken = (environmentId: EnvironmentId) =>
    Effect.gen(function* () {
      const grant = yield* auth.issueRoadmapLinkGrant({ environmentId });
      const exchanged = yield* auth.exchangeBootstrapCredentialForAccessToken(
        grant.credential,
        undefined,
        { deviceType: "bot" },
      );
      return exchanged.access_token;
    });
  const request = (
    path: string,
    token: string | null,
    body?: unknown,
  ): Effect.Effect<{ readonly status: number; readonly json: any }> =>
    Effect.promise(async () => {
      const response = await handler(
        new Request(`http://localhost${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
      const text = await response.text();
      return { status: response.status, json: text.length === 0 ? null : JSON.parse(text) };
    });
  return { auth, roadmap, linkToken, request };
});

// Live clock: the web handler runs on its own runtime and the real clock, so a
// session issued under the test clock, in 1970, would read as long expired.
describe("roadmap HTTP API", () => {
  it.live("serves a link session and refuses every other credential", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      yield* home.roadmap.dispatch(create("a"), { _tag: "user" });
      const token = yield* home.linkToken(LAPTOP);

      const snapshot = yield* home.request("/api/roadmap/snapshot", token);
      expect(snapshot.status).toBe(200);
      expect(snapshot.json.items.map((item: { id: string }) => item.id)).toEqual(["a"]);
      expect(snapshot.json.areas.work.unit).toBe("points");

      const administrative = yield* home.auth.issueSession();
      expect((yield* home.request("/api/roadmap/snapshot", administrative.token)).status).toBe(401);
      expect((yield* home.request("/api/roadmap/snapshot", null)).status).toBe(401);
    }).pipe(Effect.scoped),
  );

  it.live("reads one item with its history, and a thread's item with its context", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const thread = { environmentId: LAPTOP, threadId: ThreadId.make("thread-1") };
      yield* home.roadmap.dispatch(create("mine", { attachThread: thread }), { _tag: "user" });
      const token = yield* home.linkToken(LAPTOP);

      const item = yield* home.request("/api/roadmap/items/mine", token);
      expect(item.status).toBe(200);
      expect(item.json.item.title).toBe("Story mine");
      expect(
        item.json.history.map((entry: { event: { type: string } }) => entry.event.type),
      ).toEqual(["roadmap.item.created"]);
      const missing = yield* home.request("/api/roadmap/items/nothing", token);
      expect(missing.json).toEqual({ item: null, history: [] });

      const context = yield* home.request("/api/roadmap/for-thread", token, { thread });
      expect(context.status).toBe(200);
      expect(context.json.items.map((entry: { id: string }) => entry.id)).toEqual(["mine"]);
      expect(context.json.context).toContain('Story "Story mine" (id mine)');
    }).pipe(Effect.scoped),
  );

  it.live("applies writes only for agents on the environment the link speaks for", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const token = yield* home.linkToken(LAPTOP);

      const accepted = yield* home.request("/api/roadmap/dispatch", token, {
        command: create("from-laptop"),
        actor: agentOn(LAPTOP),
      });
      expect(accepted.status).toBe(200);
      expect(accepted.json.itemId).toBe("from-laptop");
      expect(yield* home.roadmap.get(RoadmapItemId.make("from-laptop"))).toMatchObject({
        _tag: "Some",
      });

      for (const actor of [agentOn(DESKTOP), { _tag: "user" }, { _tag: "github" }]) {
        const refused = yield* home.request("/api/roadmap/dispatch", token, {
          command: create(`refused-${actor._tag}`),
          actor,
        });
        expect(refused.status).toBe(409);
        expect(refused.json).toMatchObject({ _tag: "RoadmapError", code: "forbidden_actor" });
      }
      const steward = yield* home.request("/api/roadmap/dispatch", token, {
        command: create("from-steward"),
        actor: { _tag: "steward", environmentId: LAPTOP },
      });
      expect(steward.status).toBe(200);
    }).pipe(Effect.scoped),
  );

  it.live("replays a repeated write instead of applying it twice", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const token = yield* home.linkToken(LAPTOP);
      const body = { command: create("once"), actor: agentOn(LAPTOP) };
      const first = yield* home.request("/api/roadmap/dispatch", token, body);
      const second = yield* home.request("/api/roadmap/dispatch", token, body);
      expect(second.json).toEqual(first.json);
      const item = yield* home.request("/api/roadmap/items/once", token);
      expect(item.json.history).toHaveLength(1);
    }).pipe(Effect.scoped),
  );

  it.live("needs roadmap:write to change anything", () =>
    Effect.gen(function* () {
      const home = yield* makeHome();
      const readOnly = yield* home.auth.issueSession({
        subject: EnvironmentAuth.roadmapLinkSubject(LAPTOP),
        scopes: [AuthRoadmapReadScope],
      });
      expect((yield* home.request("/api/roadmap/snapshot", readOnly.token)).status).toBe(200);
      const refused = yield* home.request("/api/roadmap/dispatch", readOnly.token, {
        command: create("nope"),
        actor: agentOn(LAPTOP),
      });
      expect(refused.status).toBe(403);
    }).pipe(Effect.scoped),
  );

  it.live("refuses when this environment is not the home, so links never chain", () =>
    Effect.gen(function* () {
      const home = yield* makeHome({ homeEnvironmentId: EnvironmentId.make("env-elsewhere") });
      const token = yield* home.linkToken(LAPTOP);
      const refused = yield* home.request("/api/roadmap/snapshot", token);
      expect(refused.status).toBe(409);
      expect(refused.json).toMatchObject({ code: "roadmap_home_elsewhere" });
    }).pipe(Effect.scoped),
  );
});
