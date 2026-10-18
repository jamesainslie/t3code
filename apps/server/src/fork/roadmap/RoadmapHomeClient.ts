/**
 * Fork: HTTP clients for the roadmap home, built the way
 * `relay/relayEnvironmentClient.ts` builds the relay's: the environment API's
 * own contract, with the link's session as a bearer credential.
 */
import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  EnvironmentHttpApi,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

export interface RoadmapHomeConnection {
  readonly homeUrl: string;
  readonly session: string;
}

/** The home's roadmap group, authorized as the link. */
export const makeRoadmapHomeClient = (connection: RoadmapHomeConnection) =>
  Effect.flatMap(HttpClient.HttpClient, (httpClient) =>
    HttpApiClient.group(EnvironmentHttpApi, {
      group: "roadmap",
      httpClient: httpClient.pipe(
        HttpClient.mapRequest(
          HttpClientRequest.setHeader("authorization", `Bearer ${connection.session}`),
        ),
      ),
      baseUrl: connection.homeUrl,
    }),
  );

export type RoadmapHomeClient = Effect.Success<ReturnType<typeof makeRoadmapHomeClient>>;

/** Spends a one-time link grant at the home's `/oauth/token` for the link's session. */
export const exchangeRoadmapLinkGrant = (input: {
  readonly homeUrl: string;
  readonly grant: string;
}) =>
  Effect.flatMap(HttpClient.HttpClient, (httpClient) =>
    HttpApiClient.group(EnvironmentHttpApi, {
      group: "auth",
      httpClient,
      baseUrl: input.homeUrl,
    }),
  ).pipe(
    Effect.flatMap((auth) =>
      auth.token({
        headers: {},
        payload: {
          grant_type: AuthTokenExchangeGrantType,
          subject_token: input.grant,
          subject_token_type: AuthEnvironmentBootstrapTokenType,
          requested_token_type: AuthAccessTokenType,
          client_device_type: "bot",
        },
      }),
    ),
  );
