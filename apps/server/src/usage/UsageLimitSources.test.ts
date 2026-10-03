import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const sourceId = UsageLimitSourceId.make("modelproxy-iris");
const kimi = { kind: "model", from: "kimi-k3", to: "moonshotai/kimi-k3", provider: "openrouter" };

/** The least of a status payload that decodes, with the gateway's routes. */
const status = {
  current: "",
  threshold: 0.9,
  inflightTotal: 0,
  queueDepth: 0,
  forecast: { fleet: { kind: "idle" } },
  accounts: [],
  routes: [kimi],
};

const statusReply = () => Response.json(status);
const downReply = () => new Response("upstream down", { status: 503 });

/**
 * A signed-in modelproxy source. The session is stored the way
 * modelproxyAuth stores it and does not expire, so no read goes near the
 * issuer unless the gateway rejects the token. `gateway` answers each status
 * read; `demand` and `wake` stand in for the client activity that lets the
 * interval run, and `statusReads` counts what reached the gateway.
 */
function harness(
  options: {
    readonly gateway?: (request: HttpClientRequest.HttpClientRequest) => Response;
    readonly issuer?: (request: HttpClientRequest.HttpClientRequest) => Response;
    readonly refreshToken?: string;
    readonly wake?: Queue.Queue<void>;
  } = {},
) {
  const counts = { statusReads: 0 };
  const demand = { active: false };
  const secrets = new Map<string, Uint8Array>([
    [
      `usage-limit-source-${Buffer.from(sourceId, "utf8").toString("base64url")}-session`,
      new TextEncoder().encode(
        JSON.stringify({
          accessToken: "token",
          ...(options.refreshToken ? { refreshToken: options.refreshToken } : {}),
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      ),
    ],
  ]);
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.url.startsWith("https://auth.test")) {
        return HttpClientResponse.fromWeb(
          request,
          options.issuer?.(request) ?? new Response("no issuer", { status: 500 }),
        );
      }
      counts.statusReads += 1;
      return HttpClientResponse.fromWeb(request, (options.gateway ?? statusReply)(request));
    }),
  );
  const layer = UsageLimitSources.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.succeed(
          ServerSecretStore.ServerSecretStore,
          ServerSecretStore.ServerSecretStore.of({
            get: (name) => Effect.sync(() => Option.fromUndefinedOr(secrets.get(name))),
            set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
            create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
            getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
            remove: (name) => Effect.sync(() => void secrets.delete(name)),
          }),
        ),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            usageLimitSources: {
              [sourceId]: {
                kind: "modelproxy",
                url: "https://iris.test",
                issuer: "https://auth.test/realms/main",
                clientId: "t3-code",
                clientSecret: "",
                enabled: true,
              },
            },
          }),
          streamChanges: Stream.empty,
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          shouldRunScopeWork: () => Effect.sync(() => demand.active),
          // Only the arrival matters to the source list, not the snapshot.
          streamChanges: (options.wake ? Stream.fromQueue(options.wake) : Stream.empty) as never,
        }),
      ),
    ),
  );
  return { counts, demand, layer };
}

/** Runs a refresh to completion, letting its retry pause elapse. */
const refreshThroughRetry = (sources: UsageLimitSources.UsageLimitSources["Service"]) =>
  Effect.gen(function* () {
    const fiber = yield* sources.refresh.pipe(Effect.forkChild);
    yield* TestClock.adjust("10 seconds");
    yield* Fiber.join(fiber);
  });

describe("UsageLimitSources", () => {
  it.effect("keeps the last good reading through one missed poll", () => {
    const gateway = { up: true };
    const { layer } = harness({ gateway: () => (gateway.up ? statusReply() : downReply()) });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const [fresh] = yield* sources.current;
      expect(fresh?.error).toBeUndefined();

      // One blip, such as a laptop waking before its network, is not an outage.
      gateway.up = false;
      yield* refreshThroughRetry(sources);
      const [blip] = yield* sources.current;
      expect(blip).toEqual(fresh);

      // Two polling intervals with no answer is.
      yield* TestClock.adjust("10 minutes");
      yield* refreshThroughRetry(sources);
      const [failed] = yield* sources.current;
      expect(failed?.error).toContain("503");
      expect(failed?.accounts).toEqual([]);
      // A routed model vanishing from the picker would silently reset every
      // thread that selected it, so an outage must not drop it.
      expect(failed?.proxy?.routes).toEqual([kimi]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("has no routes when the first read fails", () => {
    const { layer } = harness({ gateway: downReply });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const [failed] = yield* sources.current;
      expect(failed?.error).toContain("503");
      expect(failed?.proxy?.routes).toBeUndefined();
    }).pipe(Effect.provide(layer));
  });

  it.effect("retries a failed read once before reporting it", () => {
    let failuresLeft = 0;
    const { counts, layer } = harness({
      gateway: () => (failuresLeft-- > 0 ? downReply() : statusReply()),
    });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      // Settle the boot read first so the scripted failure lands on ours.
      yield* refreshThroughRetry(sources);
      failuresLeft = 1;
      const before = counts.statusReads;
      yield* refreshThroughRetry(sources);
      const [read] = yield* sources.current;
      expect(read?.error).toBeUndefined();
      expect(read?.proxy?.routes).toEqual([kimi]);
      expect(counts.statusReads - before).toBe(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("signs in again through the issuer when the gateway rejects the token", () => {
    const { layer } = harness({
      refreshToken: "refresh",
      gateway: (request) =>
        request.headers["authorization"] === "Bearer fresh"
          ? statusReply()
          : new Response("invalid_token", { status: 401 }),
      issuer: (request) =>
        request.url.endsWith("/openid-configuration")
          ? Response.json({
              device_authorization_endpoint: "https://auth.test/device",
              token_endpoint: "https://auth.test/token",
            })
          : Response.json({ access_token: "fresh", refresh_token: "refresh", expires_in: 300 }),
    });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const [read] = yield* sources.current;
      expect(read?.error).toBeUndefined();
      expect(read?.proxy?.auth).toEqual({ state: "signedIn" });
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports a token the gateway still rejects after a fresh sign-in", () => {
    const { counts, layer } = harness({
      refreshToken: "refresh",
      gateway: () => new Response("invalid_token", { status: 401 }),
      issuer: (request) =>
        request.url.endsWith("/openid-configuration")
          ? Response.json({
              device_authorization_endpoint: "https://auth.test/device",
              token_endpoint: "https://auth.test/token",
            })
          : Response.json({ access_token: "fresh", refresh_token: "refresh", expires_in: 300 }),
    });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const before = counts.statusReads;
      yield* refreshThroughRetry(sources);
      const [read] = yield* sources.current;
      expect(read?.error).toContain("401");
      // One read with the old token and one with the new; a rejection is not retried.
      expect(counts.statusReads - before).toBe(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads again when a client comes back to a source that failed", () =>
    Effect.gen(function* () {
      const gateway = { up: false };
      const wake = yield* Queue.unbounded<void>();
      const { demand, layer } = harness({
        gateway: () => (gateway.up ? statusReply() : downReply()),
        wake,
      });
      yield* Effect.gen(function* () {
        const sources = yield* UsageLimitSources.UsageLimitSources;
        yield* refreshThroughRetry(sources);
        expect((yield* sources.current)[0]?.error).toContain("503");

        gateway.up = true;
        const recovered = yield* sources.streamChanges.pipe(
          Stream.filter((snapshots) => snapshots[0]?.error === undefined),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        demand.active = true;
        yield* Queue.offer(wake, undefined);
        const [read] = Option.getOrThrow(yield* Fiber.join(recovered));
        expect(read?.proxy?.routes).toEqual([kimi]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
