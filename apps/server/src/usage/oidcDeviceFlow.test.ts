import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeOidcDeviceFlow } from "./oidcDeviceFlow.ts";

const client = {
  issuer: "https://auth.test/realms/main",
  clientId: "t3-code",
  clientSecret: "client-secret",
} as const;

interface Seen {
  readonly url: string;
  readonly form: URLSearchParams;
  readonly authorization: string | undefined;
}

function fixture(
  token: (attempt: number, form: URLSearchParams) => { status: number; body: unknown },
) {
  const seen: Seen[] = [];
  let tokenAttempts = 0;
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const form = new URLSearchParams(
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      );
      seen.push({ url: request.url, form, authorization: request.headers.authorization });
      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            issuer: client.issuer,
            device_authorization_endpoint: `${client.issuer}/protocol/openid-connect/auth/device`,
            token_endpoint: `${client.issuer}/protocol/openid-connect/token`,
          }),
        );
      }
      if (request.url.endsWith("/auth/device")) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            device_code: "device-code",
            user_code: "ABCD-EFGH",
            verification_uri: "https://auth.test/device",
            verification_uri_complete: "https://auth.test/device?user_code=ABCD-EFGH",
            expires_in: 600,
            interval: 5,
          }),
        );
      }
      const reply = token(++tokenAttempts, form);
      return HttpClientResponse.fromWeb(
        request,
        Response.json(reply.body, { status: reply.status }),
      );
    }),
  );
  return {
    seen,
    flow: makeOidcDeviceFlow.pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
}

const basic = `Basic ${Buffer.from("t3-code:client-secret").toString("base64")}`;

describe("oidcDeviceFlow", () => {
  it.effect("discovers the endpoints and starts a device authorization", () =>
    Effect.gen(function* () {
      const { flow, seen } = fixture(() => ({ status: 200, body: {} }));
      const api = yield* flow;
      const endpoints = yield* api.discover(client.issuer);
      const started = yield* api.startDeviceAuthorization(
        client,
        endpoints,
        "openid offline_access",
      );
      expect(seen[0]?.url).toBe(`${client.issuer}/.well-known/openid-configuration`);
      expect(seen[1]?.authorization).toBe(basic);
      expect(seen[1]?.form.get("scope")).toBe("openid offline_access");
      expect(started.userCode).toBe("ABCD-EFGH");
      expect(started.verificationUrl).toBe("https://auth.test/device");
      expect(started.verificationUrlComplete).toBe("https://auth.test/device?user_code=ABCD-EFGH");
      expect(started.intervalSeconds).toBe(5);
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      expect(Date.parse(started.expiresAt) - nowMs).toBeGreaterThan(590_000);
    }),
  );

  it.effect("reports pending, slow-down, and the grant with its expiry", () =>
    Effect.gen(function* () {
      const { flow, seen } = fixture((attempt) =>
        attempt === 1
          ? { status: 400, body: { error: "authorization_pending" } }
          : attempt === 2
            ? { status: 400, body: { error: "slow_down" } }
            : {
                status: 200,
                body: {
                  access_token: "access",
                  refresh_token: "refresh",
                  expires_in: 300,
                },
              },
      );
      const api = yield* flow;
      const endpoints = yield* api.discover(client.issuer);
      const poll = () => api.pollDeviceToken(client, endpoints, "device-code");
      expect(yield* poll()).toEqual({ _tag: "pending", slowDown: false });
      expect(yield* poll()).toEqual({ _tag: "pending", slowDown: true });
      const granted = yield* poll();
      expect(granted._tag).toBe("granted");
      if (granted._tag !== "granted") return;
      expect(granted.tokens.accessToken).toBe("access");
      expect(granted.tokens.refreshToken).toBe("refresh");
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      expect(Date.parse(granted.tokens.expiresAt) - nowMs).toBeGreaterThan(290_000);
      const form = seen.at(-1)?.form;
      expect(form?.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
      expect(form?.get("device_code")).toBe("device-code");
    }),
  );

  it.effect("turns expiry and denial into terminal outcomes", () =>
    Effect.gen(function* () {
      const { flow } = fixture((attempt) => ({
        status: 400,
        body: { error: attempt === 1 ? "expired_token" : "access_denied" },
      }));
      const api = yield* flow;
      const endpoints = yield* api.discover(client.issuer);
      expect(yield* api.pollDeviceToken(client, endpoints, "device-code")).toEqual({
        _tag: "denied",
        reason: "expired",
      });
      expect(yield* api.pollDeviceToken(client, endpoints, "device-code")).toEqual({
        _tag: "denied",
        reason: "accessDenied",
      });
    }),
  );

  it.effect("refreshes with the refresh token and keeps the old one when none is returned", () =>
    Effect.gen(function* () {
      const { flow, seen } = fixture(() => ({
        status: 200,
        body: { access_token: "access-2", expires_in: 60 },
      }));
      const api = yield* flow;
      const endpoints = yield* api.discover(client.issuer);
      const tokens = yield* api.refresh(client, endpoints, "refresh-1");
      expect(tokens.accessToken).toBe("access-2");
      expect(tokens.refreshToken).toBe("refresh-1");
      expect(seen.at(-1)?.form.get("grant_type")).toBe("refresh_token");
    }),
  );

  it.effect("fails a refresh whose grant the issuer no longer honours", () =>
    Effect.gen(function* () {
      const { flow } = fixture(() => ({ status: 400, body: { error: "invalid_grant" } }));
      const api = yield* flow;
      const endpoints = yield* api.discover(client.issuer);
      const result = yield* api.refresh(client, endpoints, "refresh-1").pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(result.failure.revoked).toBe(true);
    }),
  );
});
