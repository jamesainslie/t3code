/**
 * Sign-in sessions for `modelproxy` usage-limit sources. One session per
 * source: the refresh and access tokens sit in the secret store beside the
 * source's client secret, a pending device-code flow lives in memory with
 * the fiber that polls the issuer for it, and every transition publishes
 * the source id so the source list re-reads and clients see the new state.
 *
 * Only the device grant is supported. It needs no redirect URI, so the T3
 * server can sit on one host while the user finishes the login in a browser
 * on another, which is the normal remote arrangement.
 *
 * @module usage/modelproxyAuth
 */
import {
  UsageLimitSourceError,
  type ModelproxyUsageLimitSourceConfig,
  type UsageLimitSourceAuthState,
  type UsageLimitSourceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  makeOidcDeviceFlow,
  type DeviceAuthorization,
  type OidcEndpoints,
  type TokenSet,
} from "./oidcDeviceFlow.ts";

const Session = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.String,
});
const decodeSession = Schema.decodeUnknownEffect(Schema.fromJsonString(Session));
const encodeSession = Schema.encodeEffect(Schema.fromJsonString(Session));

/** Scopes the session asks for: identity plus a refresh token that survives the browser session. */
const SCOPE = "openid offline_access";
/** Refresh this far ahead of expiry so a token handed out is good for the whole read. */
const REFRESH_AHEAD = Duration.seconds(60);
/** The issuer's back-off request adds this to the polling interval (RFC 8628 §3.5). */
const SLOW_DOWN_SECONDS = 5;

export class ModelproxySessionError extends Schema.TaggedError<ModelproxySessionError>()(
  "ModelproxySessionError",
  {
    reason: Schema.Literals(["signedOut", "refreshFailed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

function sessionSecretName(sourceId: string): string {
  return `usage-limit-source-${Buffer.from(sourceId, "utf8").toString("base64url")}-session`;
}

interface Pending {
  readonly authorization: DeviceAuthorization;
  readonly fiber: Fiber.Fiber<void>;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const makeModelproxyAuth = Effect.gen(function* () {
  const oidc = yield* makeOidcDeviceFlow;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const scope = yield* Effect.scope;
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<UsageLimitSourceId>(),
    PubSub.shutdown,
  );
  const pending = new Map<string, Pending>();
  const sessions = new Map<string, Option.Option<TokenSet>>();
  const endpoints = new Map<string, OidcEndpoints>();

  const publish = (sourceId: UsageLimitSourceId) => PubSub.publish(changes, sourceId);

  const discover = (issuer: string) =>
    Effect.gen(function* () {
      const cached = endpoints.get(issuer);
      if (cached) return cached;
      const found = yield* oidc.discover(issuer);
      endpoints.set(issuer, found);
      return found;
    });

  const loadSession = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      const cached = sessions.get(sourceId);
      if (cached) return cached;
      const stored = yield* secretStore
        .get(sessionSecretName(sourceId))
        .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
      const session = Option.isSome(stored)
        ? yield* decodeSession(textDecoder.decode(stored.value)).pipe(
            Effect.map(Option.some),
            Effect.orElseSucceed(() => Option.none<TokenSet>()),
          )
        : Option.none<TokenSet>();
      sessions.set(sourceId, session);
      return session;
    });

  const saveSession = (sourceId: UsageLimitSourceId, tokens: TokenSet) =>
    Effect.gen(function* () {
      sessions.set(sourceId, Option.some(tokens));
      const json = yield* encodeSession(tokens);
      yield* secretStore.set(sessionSecretName(sourceId), textEncoder.encode(json));
    }).pipe(Effect.ignoreCause({ log: true }));

  const clearSession = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      sessions.set(sourceId, Option.none());
      yield* secretStore.remove(sessionSecretName(sourceId));
    }).pipe(Effect.ignoreCause({ log: true }));

  const clearPending = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      const flow = pending.get(sourceId);
      if (!flow) return;
      pending.delete(sourceId);
      yield* Fiber.interrupt(flow.fiber);
    });

  const authState = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* (): Effect.fn.Return<UsageLimitSourceAuthState> {
      const flow = pending.get(sourceId);
      if (flow) {
        const { userCode, verificationUrl, verificationUrlComplete, expiresAt } =
          flow.authorization;
        return {
          state: "pending",
          userCode,
          verificationUrl,
          ...(verificationUrlComplete ? { verificationUrlComplete } : {}),
          expiresAt,
        };
      }
      const session = yield* loadSession(sourceId);
      return { state: Option.isSome(session) ? "signedIn" : "signedOut" };
    });

  /** A token good for at least the next minute, refreshed through the issuer when needed. */
  const accessToken = Effect.fn("ModelproxyAuth.accessToken")(function* (
    sourceId: UsageLimitSourceId,
    config: ModelproxyUsageLimitSourceConfig,
  ): Effect.fn.Return<string, ModelproxySessionError> {
    const session = yield* loadSession(sourceId);
    if (Option.isNone(session)) {
      return yield* new ModelproxySessionError({ reason: "signedOut", detail: "Not signed in." });
    }
    const now = yield* DateTime.now;
    const expiresAt = DateTime.makeUnsafe(session.value.expiresAt);
    if (
      DateTime.toEpochMillis(expiresAt) - DateTime.toEpochMillis(now) >
      Duration.toMillis(REFRESH_AHEAD)
    ) {
      return session.value.accessToken;
    }
    if (!session.value.refreshToken) {
      yield* clearSession(sourceId);
      return yield* new ModelproxySessionError({
        reason: "signedOut",
        detail: "The session expired. Sign in again.",
      });
    }
    const refreshed = yield* Effect.gen(function* () {
      const found = yield* discover(config.issuer);
      return yield* oidc.refresh(config, found, session.value.refreshToken!);
    }).pipe(Effect.result);
    if (refreshed._tag === "Failure") {
      if (refreshed.failure.revoked) {
        yield* clearSession(sourceId);
        yield* publish(sourceId);
        return yield* new ModelproxySessionError({
          reason: "signedOut",
          detail: "The session was revoked. Sign in again.",
        });
      }
      return yield* new ModelproxySessionError({
        reason: "refreshFailed",
        detail: refreshed.failure.detail,
      });
    }
    yield* saveSession(sourceId, refreshed.success);
    return refreshed.success.accessToken;
  });

  // Polls the token endpoint until the user finishes, the code expires, or
  // the flow is cancelled. Runs in the service scope so a cancelled or
  // replaced flow is interrupted rather than left polling.
  const poll = (
    sourceId: UsageLimitSourceId,
    config: ModelproxyUsageLimitSourceConfig,
    found: OidcEndpoints,
    authorization: DeviceAuthorization,
  ) =>
    Effect.gen(function* () {
      let interval = authorization.intervalSeconds;
      const deadline = Date.parse(authorization.expiresAt);
      while (true) {
        yield* Effect.sleep(Duration.seconds(interval));
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        if (now >= deadline) return;
        const outcome = yield* oidc.pollDeviceToken(config, found, authorization.deviceCode);
        switch (outcome._tag) {
          case "pending":
            if (outcome.slowDown) interval += SLOW_DOWN_SECONDS;
            continue;
          case "granted":
            yield* saveSession(sourceId, outcome.tokens);
            return;
          case "denied":
            return;
        }
      }
    }).pipe(
      Effect.ignoreCause({ log: true }),
      // The finaliser runs on completion and on interruption alike; only a
      // flow that finished on its own owns the pending slot at that point.
      Effect.ensuring(
        Effect.gen(function* () {
          const flow = pending.get(sourceId);
          if (flow?.authorization.deviceCode === authorization.deviceCode) pending.delete(sourceId);
          yield* publish(sourceId);
        }),
      ),
    );

  const start = Effect.fn("ModelproxyAuth.start")(function* (
    sourceId: UsageLimitSourceId,
    config: ModelproxyUsageLimitSourceConfig,
  ): Effect.fn.Return<UsageLimitSourceAuthState, UsageLimitSourceError> {
    if (pending.has(sourceId)) return yield* authState(sourceId);
    if (config.clientSecret.length === 0) {
      return yield* new UsageLimitSourceError({ detail: "No client secret configured." });
    }
    const started = yield* Effect.gen(function* () {
      const found = yield* discover(config.issuer);
      const authorization = yield* oidc.startDeviceAuthorization(config, found, SCOPE);
      return { found, authorization };
    }).pipe(Effect.mapError((error) => new UsageLimitSourceError({ detail: error.detail })));
    const fiber = yield* Effect.forkIn(
      poll(sourceId, config, started.found, started.authorization),
      scope,
    );
    pending.set(sourceId, { authorization: started.authorization, fiber });
    yield* publish(sourceId);
    return yield* authState(sourceId);
  });

  const cancel = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      yield* clearPending(sourceId);
      yield* publish(sourceId);
      return yield* authState(sourceId);
    });

  const signOut = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      yield* clearPending(sourceId);
      yield* clearSession(sourceId);
      yield* publish(sourceId);
      return yield* authState(sourceId);
    });

  /** A removed source takes its session with it; nothing to publish for a source nobody lists. */
  const forget = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      yield* clearPending(sourceId);
      yield* clearSession(sourceId);
      sessions.delete(sourceId);
    });

  return {
    authState,
    accessToken,
    start,
    cancel,
    signOut,
    forget,
    get changes() {
      return Stream.unwrap(
        PubSub.subscribe(changes).pipe(
          Effect.map((subscription) => Stream.fromSubscription(subscription)),
        ),
      );
    },
  };
});

export type ModelproxyAuth = Effect.Success<typeof makeModelproxyAuth>;
