/**
 * The OAuth 2.0 device authorization grant (RFC 8628) against an OIDC
 * issuer, plus the refresh grant that keeps a session alive afterwards.
 * Used by `modelproxy` usage-limit sources: the server signs the user in
 * without a browser callback, so it works when the T3 server is on a
 * different host from the browser that completes the login.
 *
 * @module usage/oidcDeviceFlow
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export interface OidcClient {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface OidcEndpoints {
  readonly deviceAuthorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

export interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly verificationUrlComplete?: string | undefined;
  readonly expiresAt: string;
  readonly intervalSeconds: number;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly expiresAt: string;
}

export type DevicePollOutcome =
  | { readonly _tag: "pending"; readonly slowDown: boolean }
  | { readonly _tag: "granted"; readonly tokens: TokenSet }
  | { readonly _tag: "denied"; readonly reason: "expired" | "accessDenied" };

export class OidcError extends Schema.TaggedError<OidcError>()("OidcError", {
  detail: Schema.String,
  /** The issuer rejected the grant itself, so retrying with the same token is pointless. */
  revoked: Schema.optional(Schema.Boolean),
}) {
  override get message(): string {
    return this.detail;
  }
}

const Discovery = Schema.Struct({
  device_authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
});
const DeviceResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  interval: Schema.optional(Schema.Number),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
});
const TokenError = Schema.Struct({ error: Schema.String });

const decodeDiscovery = Schema.decodeUnknownEffect(Discovery);
const decodeDevice = Schema.decodeUnknownEffect(DeviceResponse);
const decodeToken = Schema.decodeUnknownEffect(TokenResponse);
const decodeTokenError = Schema.decodeUnknownEffect(TokenError);

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const DEFAULT_INTERVAL_SECONDS = 5;

export const makeOidcDeviceFlow = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const failed = (detail: string) => () => new OidcError({ detail });

  const discover = Effect.fn("OidcDeviceFlow.discover")(function* (
    issuer: string,
  ): Effect.fn.Return<OidcEndpoints, OidcError> {
    const url = yield* Effect.try({
      try: () =>
        new URL(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`).toString(),
      catch: failed("The issuer URL is not valid."),
    });
    const body = yield* client.get(url).pipe(
      Effect.flatMap((response) => response.json),
      Effect.timeout("15 seconds"),
      Effect.mapError(failed("The issuer's discovery document could not be read.")),
    );
    const discovery = yield* decodeDiscovery(body).pipe(
      Effect.mapError(failed("The issuer does not offer the device authorization grant.")),
    );
    return {
      deviceAuthorizationEndpoint: discovery.device_authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
    };
  });

  // Client credentials go in the Basic header, the standard place for a
  // confidential client; Keycloak accepts either that or form fields.
  const post = (oidc: OidcClient, url: string, form: Record<string, string>) =>
    client
      .execute(
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.basicAuth(oidc.clientId, oidc.clientSecret),
          HttpClientRequest.bodyUrlParams(form),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(Effect.map((body) => ({ status: response.status, body }))),
        ),
        Effect.timeout("15 seconds"),
      );

  const expiresAt = (seconds: number) =>
    DateTime.now.pipe(
      Effect.map((now) => DateTime.formatIso(DateTime.addDuration(now, `${seconds} seconds`))),
    );

  const startDeviceAuthorization = Effect.fn("OidcDeviceFlow.startDeviceAuthorization")(function* (
    oidc: OidcClient,
    endpoints: OidcEndpoints,
    scope: string,
  ): Effect.fn.Return<DeviceAuthorization, OidcError> {
    const response = yield* post(oidc, endpoints.deviceAuthorizationEndpoint, { scope }).pipe(
      Effect.mapError(failed("The issuer did not answer the device authorization request.")),
    );
    if (response.status !== 200) {
      return yield* new OidcError({
        detail: `The issuer refused the device authorization request (HTTP ${response.status}).`,
      });
    }
    const device = yield* decodeDevice(response.body).pipe(
      Effect.mapError(failed("The issuer's device authorization response was not understood.")),
    );
    return {
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUrl: device.verification_uri,
      ...(device.verification_uri_complete
        ? { verificationUrlComplete: device.verification_uri_complete }
        : {}),
      expiresAt: yield* expiresAt(device.expires_in),
      intervalSeconds: device.interval ?? DEFAULT_INTERVAL_SECONDS,
    };
  });

  const tokens = (response: typeof TokenResponse.Type, previousRefresh?: string) => {
    const refreshToken = response.refresh_token ?? previousRefresh;
    return expiresAt(response.expires_in).pipe(
      Effect.map((at): TokenSet => ({
        accessToken: response.access_token,
        ...(refreshToken !== undefined ? { refreshToken } : {}),
        expiresAt: at,
      })),
    );
  };

  const pollDeviceToken = Effect.fn("OidcDeviceFlow.pollDeviceToken")(function* (
    oidc: OidcClient,
    endpoints: OidcEndpoints,
    deviceCode: string,
  ): Effect.fn.Return<DevicePollOutcome, OidcError> {
    const response = yield* post(oidc, endpoints.tokenEndpoint, {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
    }).pipe(Effect.mapError(failed("The issuer did not answer the token request.")));
    if (response.status === 200) {
      const granted = yield* decodeToken(response.body).pipe(
        Effect.mapError(failed("The issuer's token response was not understood.")),
      );
      return { _tag: "granted", tokens: yield* tokens(granted) };
    }
    const error = yield* decodeTokenError(response.body).pipe(
      Effect.orElseSucceed(() => ({ error: `http_${response.status}` })),
    );
    switch (error.error) {
      case "authorization_pending":
        return { _tag: "pending", slowDown: false };
      case "slow_down":
        return { _tag: "pending", slowDown: true };
      case "expired_token":
        return { _tag: "denied", reason: "expired" };
      case "access_denied":
        return { _tag: "denied", reason: "accessDenied" };
      default:
        return yield* new OidcError({
          detail: `The issuer rejected the device code (${error.error}).`,
        });
    }
  });

  const refresh = Effect.fn("OidcDeviceFlow.refresh")(function* (
    oidc: OidcClient,
    endpoints: OidcEndpoints,
    refreshToken: string,
  ): Effect.fn.Return<TokenSet, OidcError> {
    const response = yield* post(oidc, endpoints.tokenEndpoint, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).pipe(Effect.mapError(failed("The issuer did not answer the refresh request.")));
    if (response.status === 200) {
      const granted = yield* decodeToken(response.body).pipe(
        Effect.mapError(failed("The issuer's token response was not understood.")),
      );
      return yield* tokens(granted, refreshToken);
    }
    const error = yield* decodeTokenError(response.body).pipe(
      Effect.orElseSucceed(() => ({ error: `http_${response.status}` })),
    );
    // invalid_grant is the issuer saying the session is gone: revoked,
    // expired offline token, or a client change. Anything else may be
    // transient and the caller keeps the session for another try.
    return yield* new OidcError({
      detail: `The issuer refused to refresh the session (${error.error}).`,
      revoked: error.error === "invalid_grant",
    });
  });

  return { discover, startDeviceAuthorization, pollDeviceToken, refresh };
});

export type OidcDeviceFlow = Effect.Success<typeof makeOidcDeviceFlow>;
