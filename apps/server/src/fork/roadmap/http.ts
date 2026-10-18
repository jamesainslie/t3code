/**
 * Fork: the roadmap home's HTTP API for linked environments. Each linked
 * environment holds a roadmap-link credential naming it, and the home applies
 * its writes only for its own agents and steward.
 */
import {
  type AuthEnvironmentScope,
  AuthRoadmapReadScope,
  AuthRoadmapWriteScope,
  EnvironmentHttpApi,
  EnvironmentRoadmapLinkAuth,
  EnvironmentRoadmapLinkPrincipal,
  type EnvironmentId,
  type RoadmapActor,
  RoadmapError,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  failEnvironmentScopeRequired,
} from "../../auth/http.ts";
import * as RoadmapService from "./RoadmapService.ts";

export const layerRoadmapLinkAuth = Layer.effect(
  EnvironmentRoadmapLinkAuth,
  Effect.gen(function* () {
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const link = yield* serverAuth.authenticateRoadmapLink(request).pipe(
          Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
            failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
          ),
          Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
            failEnvironmentInternal("internal_error", error),
          ),
        );
        return yield* httpEffect.pipe(Effect.provideService(EnvironmentRoadmapLinkPrincipal, link));
      });
  }),
);

const requireLinkScope = (scope: AuthEnvironmentScope) =>
  Effect.gen(function* () {
    const link = yield* EnvironmentRoadmapLinkPrincipal;
    if (!link.scopes.has(scope)) return yield* failEnvironmentScopeRequired(scope);
    return link;
  });

/** The environment an actor acts from; users and GitHub act from none. */
const actorEnvironment = (actor: RoadmapActor): EnvironmentId | null =>
  actor._tag === "agent"
    ? actor.thread.environmentId
    : actor._tag === "steward"
      ? actor.environmentId
      : null;

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "roadmap",
  Effect.fnUntraced(function* (handlers) {
    const roadmap = yield* RoadmapService.RoadmapService;

    // Without this, an environment that is not the home but holds a link of
    // its own would forward the call on, and links could chain or loop.
    const requireHome = roadmap.isHome.pipe(
      Effect.flatMap((home) =>
        home
          ? Effect.void
          : Effect.fail(
              new RoadmapError({
                code: "roadmap_home_elsewhere",
                message: "This environment is not the roadmap home.",
              }),
            ),
      ),
    );

    const read = Effect.fnUntraced(function* (endpoint: string) {
      yield* annotateEnvironmentRequest(endpoint);
      yield* requireLinkScope(AuthRoadmapReadScope);
      yield* requireHome;
    });

    return handlers
      .handle(
        "snapshot",
        Effect.fn("environment.roadmap.snapshot")(function* (args) {
          yield* read(args.endpoint.name);
          return yield* roadmap.snapshot();
        }),
      )
      .handle(
        "item",
        Effect.fn("environment.roadmap.item")(function* (args) {
          yield* read(args.endpoint.name);
          return yield* roadmap.item(args.params.itemId);
        }),
      )
      .handle(
        "forThread",
        Effect.fn("environment.roadmap.forThread")(function* (args) {
          yield* read(args.endpoint.name);
          return yield* roadmap.threadContext(args.payload.thread);
        }),
      )
      .handle(
        "dispatch",
        Effect.fn("environment.roadmap.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          const link = yield* requireLinkScope(AuthRoadmapWriteScope);
          yield* requireHome;
          const { command, actor } = args.payload;
          if (actorEnvironment(actor) !== link.environmentId) {
            return yield* new RoadmapError({
              code: "forbidden_actor",
              message: "A linked environment can only act for its own agents and steward.",
            });
          }
          return yield* roadmap.dispatch(command, actor);
        }),
      );
  }),
);
