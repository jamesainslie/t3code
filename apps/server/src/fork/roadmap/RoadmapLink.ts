/**
 * Fork: this environment's link to the roadmap home, when it is not the home.
 * The link is the home's URL and a roadmap-link session the home issued for
 * this environment. Calls go one way, from here to the home; the home never
 * connects out.
 */
import {
  EnvironmentAuthInvalidError,
  EnvironmentRequestInvalidError,
  EnvironmentScopeRequiredError,
  isRoadmapError,
  type RoadmapActor,
  type RoadmapCommand,
  type RoadmapDispatchResult,
  type RoadmapError,
  type RoadmapItemId,
  type RoadmapLinkConfigureInput,
  RoadmapLinkError,
  type RoadmapLinkItem,
  type RoadmapLinkSnapshot,
  type RoadmapThreadContext,
  type RoadmapThreadRef,
} from "@lathe/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import {
  exchangeRoadmapLinkGrant,
  makeRoadmapHomeClient,
  type RoadmapHomeClient,
  type RoadmapHomeConnection,
} from "./RoadmapHomeClient.ts";

export const HOME_URL_SECRET = "roadmap-home-url";
export const HOME_CREDENTIAL_SECRET = "roadmap-home-credential";

// Agents wait on reads, so a home that has gone quiet must fail fast rather
// than hold a tool call; writes do not wait on this, they queue.
const REQUEST_TIMEOUT = Duration.seconds(10);

export class RoadmapLinkUnavailableError extends Schema.TaggedError<RoadmapLinkUnavailableError>()(
  "RoadmapLinkUnavailableError",
  {
    reason: Schema.Literals(["not_linked", "unreachable", "unauthorized"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "not_linked"
      ? "This environment is not linked to the roadmap home."
      : this.reason === "unauthorized"
        ? "The roadmap home no longer accepts this environment's link."
        : "The roadmap home could not be reached.";
  }
}

export interface RoadmapLinkState {
  readonly homeUrl: string | null;
  /** When the current run of failed calls began; null while the home answers. */
  readonly unreachableSince: string | null;
}

export class RoadmapLink extends Context.Service<
  RoadmapLink,
  {
    readonly isLinked: Effect.Effect<boolean>;
    readonly status: Effect.Effect<RoadmapLinkState>;
    /**
     * Links with a one-time grant minted on the home, spending it there for the
     * link's session; null unlinks. Nothing is stored unless the home accepts.
     */
    readonly configure: (
      link: RoadmapLinkConfigureInput["link"],
    ) => Effect.Effect<void, RoadmapLinkError>;
    readonly snapshot: Effect.Effect<
      RoadmapLinkSnapshot,
      RoadmapError | RoadmapLinkUnavailableError
    >;
    readonly item: (
      itemId: RoadmapItemId,
    ) => Effect.Effect<RoadmapLinkItem, RoadmapError | RoadmapLinkUnavailableError>;
    readonly threadContext: (
      thread: RoadmapThreadRef,
    ) => Effect.Effect<RoadmapThreadContext, RoadmapError | RoadmapLinkUnavailableError>;
    /** A `RoadmapError` is the home's answer; anything else never reached it. */
    readonly dispatch: (
      command: RoadmapCommand,
      actor: RoadmapActor,
    ) => Effect.Effect<RoadmapDispatchResult, RoadmapError | RoadmapLinkUnavailableError>;
  }
>()("lathe/fork/roadmap/RoadmapLink") {}

const isAuthInvalid = Schema.is(EnvironmentAuthInvalidError);
const isScopeRequired = Schema.is(EnvironmentScopeRequiredError);
const isRequestInvalid = Schema.is(EnvironmentRequestInvalidError);

const isLinkRefused = (cause: unknown) => isAuthInvalid(cause) || isScopeRequired(cause);

const isGrantRefused = (cause: unknown) => isAuthInvalid(cause) || isRequestInvalid(cause);

/** The origin, which is where the environment API lives; null for anything but http(s). */
function normalizeHomeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;

  const readSecret = (name: string) =>
    secrets.get(name).pipe(
      Effect.map((bytes) =>
        Option.filter(
          Option.map(bytes, (value) => new TextDecoder().decode(value)),
          Boolean,
        ),
      ),
    );
  const stored = yield* Effect.all([
    readSecret(HOME_URL_SECRET),
    readSecret(HOME_CREDENTIAL_SECRET),
  ]).pipe(
    Effect.map(([homeUrl, session]) =>
      Option.isSome(homeUrl) && Option.isSome(session)
        ? Option.some<RoadmapHomeConnection>({ homeUrl: homeUrl.value, session: session.value })
        : Option.none<RoadmapHomeConnection>(),
    ),
    Effect.catch((error) =>
      Effect.logWarning("Could not read the roadmap link; starting unlinked.", { error }).pipe(
        Effect.as(Option.none<RoadmapHomeConnection>()),
      ),
    ),
  );
  const connection = yield* Ref.make(stored);
  const unreachableSince = yield* Ref.make<string | null>(null);
  const configuring = yield* Semaphore.make(1);

  const markAnswered = Ref.set(unreachableSince, null);
  const markUnreachable = DateTime.now.pipe(
    Effect.flatMap((now) =>
      Ref.update(unreachableSince, (since) => since ?? DateTime.formatIso(now)),
    ),
  );

  const call = <A, E>(
    request: (client: RoadmapHomeClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, RoadmapError | RoadmapLinkUnavailableError> =>
    Effect.gen(function* () {
      const current = yield* Ref.get(connection);
      if (Option.isNone(current)) {
        return yield* new RoadmapLinkUnavailableError({ reason: "not_linked" });
      }
      const client = yield* makeRoadmapHomeClient(current.value).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
      );
      return yield* request(client).pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause): RoadmapError | RoadmapLinkUnavailableError =>
          isRoadmapError(cause)
            ? cause
            : new RoadmapLinkUnavailableError({
                reason: isLinkRefused(cause) ? "unauthorized" : "unreachable",
                cause,
              }),
        ),
        Effect.tap(() => markAnswered),
        Effect.tapError((error) =>
          error._tag === "RoadmapError" ? markAnswered : markUnreachable,
        ),
      );
    });

  const storageFailed = (cause: unknown) =>
    Effect.logWarning("Could not save the roadmap link.", { cause }).pipe(
      Effect.andThen(
        Effect.fail(
          new RoadmapLinkError({ reason: "storage", message: "Could not save the roadmap link." }),
        ),
      ),
    );

  const connect = (input: { readonly homeUrl: string; readonly credential: string }) =>
    Effect.gen(function* () {
      const homeUrl = normalizeHomeUrl(input.homeUrl);
      if (homeUrl === null) {
        return yield* new RoadmapLinkError({
          reason: "invalid_url",
          message: "The roadmap home's address must be an http or https URL.",
        });
      }
      const host = new URL(homeUrl).host;
      const exchanged = yield* exchangeRoadmapLinkGrant({ homeUrl, grant: input.credential }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError((cause) =>
          isGrantRefused(cause)
            ? new RoadmapLinkError({
                reason: "credential_rejected",
                message: `The roadmap home at ${host} refused the link credential. Link again for a new one.`,
              })
            : new RoadmapLinkError({
                reason: "unreachable",
                message: `Could not reach the roadmap home at ${host}.`,
              }),
        ),
      );
      const encode = (value: string) => new TextEncoder().encode(value);
      yield* secrets.set(HOME_URL_SECRET, encode(homeUrl)).pipe(Effect.catch(storageFailed));
      yield* secrets
        .set(HOME_CREDENTIAL_SECRET, encode(exchanged.access_token))
        .pipe(Effect.catch(storageFailed));
      yield* Ref.set(connection, Option.some({ homeUrl, session: exchanged.access_token }));
      yield* markAnswered;
    });

  const disconnect = Effect.gen(function* () {
    yield* secrets.remove(HOME_CREDENTIAL_SECRET).pipe(Effect.catch(storageFailed));
    yield* secrets.remove(HOME_URL_SECRET).pipe(Effect.catch(storageFailed));
    yield* Ref.set(connection, Option.none());
    yield* markAnswered;
  });

  return RoadmapLink.of({
    isLinked: Ref.get(connection).pipe(Effect.map(Option.isSome)),
    status: Effect.all({
      homeUrl: Ref.get(connection).pipe(
        Effect.map((current) => Option.getOrNull(Option.map(current, (link) => link.homeUrl))),
      ),
      unreachableSince: Ref.get(unreachableSince),
    }),
    configure: (link) => configuring.withPermits(1)(link === null ? disconnect : connect(link)),
    snapshot: call((client) => client.snapshot({ headers: {} })),
    item: (itemId) => call((client) => client.item({ headers: {}, params: { itemId } })),
    threadContext: (thread) =>
      call((client) => client.forThread({ headers: {}, payload: { thread } })),
    dispatch: (command, actor) =>
      call((client) => client.dispatch({ headers: {}, payload: { command, actor } })),
  });
});

export const layer = Layer.effect(RoadmapLink, make);
