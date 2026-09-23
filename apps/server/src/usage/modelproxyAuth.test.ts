import { describe, expect, it } from "@effect/vitest";
import { UsageLimitSourceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { makeModelproxyAuth } from "./modelproxyAuth.ts";

const sourceId = UsageLimitSourceId.make("modelproxy-iris");
const config = {
  kind: "modelproxy",
  url: "https://iris.test",
  issuer: "https://auth.test/realms/main",
  clientId: "t3-code",
  clientSecret: "client-secret",
  enabled: true,
} as const;

function memorySecretStore() {
  const secrets = new Map<string, Uint8Array>();
  const service = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
    remove: (name) => Effect.sync(() => void secrets.delete(name)),
  });
  return { secrets, service };
}

/** Token endpoint script: each poll or refresh consumes the next reply. */
function fixture(replies: Array<{ status: number; body: unknown }>) {
  const forms: URLSearchParams[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.url.endsWith("/openid-configuration")) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            device_authorization_endpoint: "https://auth.test/device",
            token_endpoint: "https://auth.test/token",
          }),
        );
      }
      if (request.url.endsWith("/device")) {
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            device_code: "device-code",
            user_code: "ABCD-EFGH",
            verification_uri: "https://auth.test/verify",
            expires_in: 600,
            interval: 5,
          }),
        );
      }
      forms.push(
        new URLSearchParams(
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        ),
      );
      const reply = replies.shift() ?? { status: 500, body: { error: "script exhausted" } };
      return HttpClientResponse.fromWeb(
        request,
        Response.json(reply.body, { status: reply.status }),
      );
    }),
  );
  const store = memorySecretStore();
  const auth = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const service = yield* makeModelproxyAuth.pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(ServerSecretStore.ServerSecretStore, store.service),
      Scope.provide(scope),
    );
    return { service, scope };
  });
  return { auth, forms, store };
}

const granted = (accessToken: string, expiresIn = 300) => ({
  status: 200,
  body: { access_token: accessToken, refresh_token: "refresh", expires_in: expiresIn },
});
const pendingReply = { status: 400, body: { error: "authorization_pending" } };

describe("modelproxyAuth", () => {
  it.effect(
    "starts a device flow, publishes the code, and signs in once the issuer grants it",
    () =>
      Effect.gen(function* () {
        const { auth, store } = fixture([pendingReply, granted("access-1")]);
        const { service, scope } = yield* auth;
        const seen: string[] = [];
        const collector = yield* service.changes.pipe(
          Stream.runForEach((id) => Effect.sync(() => void seen.push(id))),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;

        const started = yield* service.start(sourceId, config);
        expect(started).toMatchObject({
          state: "pending",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.test/verify",
        });
        // Idempotent while pending: a second start returns the same code.
        expect(yield* service.start(sourceId, config)).toEqual(started);

        yield* TestClock.adjust("5 seconds");
        expect((yield* service.authState(sourceId)).state).toBe("pending");
        yield* TestClock.adjust("5 seconds");
        expect((yield* service.authState(sourceId)).state).toBe("signedIn");
        expect(yield* service.accessToken(sourceId, config)).toBe("access-1");
        expect([...store.secrets.keys()].some((name) => name.endsWith("-session"))).toBe(true);
        expect(seen.filter((id) => id === sourceId).length).toBeGreaterThanOrEqual(2);
        yield* Fiber.interrupt(collector);
        yield* Scope.close(scope, Exit.void);
      }),
  );

  it.effect("cancel stops polling and leaves the source signed out", () =>
    Effect.gen(function* () {
      const { auth, forms } = fixture([pendingReply, granted("never")]);
      const { service, scope } = yield* auth;
      yield* service.start(sourceId, config);
      yield* TestClock.adjust("5 seconds");
      expect(forms).toHaveLength(1);
      expect(yield* service.cancel(sourceId)).toEqual({ state: "signedOut" });
      yield* TestClock.adjust("30 seconds");
      expect(forms).toHaveLength(1);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("refreshes an expiring session and signs out when the issuer revokes it", () =>
    Effect.gen(function* () {
      const { auth, forms } = fixture([
        granted("access-1", 30),
        granted("access-2", 300),
        { status: 400, body: { error: "invalid_grant" } },
      ]);
      const { service, scope } = yield* auth;
      yield* service.start(sourceId, config);
      yield* TestClock.adjust("5 seconds");
      expect((yield* service.authState(sourceId)).state).toBe("signedIn");
      // 30s left is inside the refresh-ahead margin, so the next read refreshes.
      expect(yield* service.accessToken(sourceId, config)).toBe("access-2");
      expect(forms.at(-1)?.get("grant_type")).toBe("refresh_token");
      yield* TestClock.adjust("400 seconds");
      const failed = yield* service.accessToken(sourceId, config).pipe(Effect.result);
      expect(failed._tag).toBe("Failure");
      if (failed._tag === "Failure") expect(failed.failure.reason).toBe("signedOut");
      expect((yield* service.authState(sourceId)).state).toBe("signedOut");
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("restores a stored session on a fresh service", () =>
    Effect.gen(function* () {
      const { auth, store } = fixture([granted("access-1", 3600)]);
      const first = yield* auth;
      yield* first.service.start(sourceId, config);
      yield* TestClock.adjust("5 seconds");
      yield* Scope.close(first.scope, Exit.void);

      const again = yield* Effect.gen(function* () {
        const scope = yield* Scope.make();
        const service = yield* makeModelproxyAuth.pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("no network expected")),
          ),
          Effect.provideService(ServerSecretStore.ServerSecretStore, store.service),
          Scope.provide(scope),
        );
        return { service, scope };
      });
      expect((yield* again.service.authState(sourceId)).state).toBe("signedIn");
      expect(yield* again.service.accessToken(sourceId, config)).toBe("access-1");
      yield* again.service.signOut(sourceId);
      expect(store.secrets.size).toBe(0);
      expect((yield* again.service.authState(sourceId)).state).toBe("signedOut");
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      expect(nowMs).toBeGreaterThan(0);
      yield* Scope.close(again.scope, Exit.void);
    }),
  );
});
