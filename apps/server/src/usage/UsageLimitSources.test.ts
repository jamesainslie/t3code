import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ServerConfigStreamEvent,
  UsageLimitSourceId,
  type UsageLimitSourceSnapshot,
} from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const encodeConfigEvent = Schema.encodeSync(ServerConfigStreamEvent);
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
        NodeCrypto.layer,
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
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed({
            ...DEFAULT_SERVER_SETTINGS,
            usageLimitSources: {
              [sourceId]: {
                kind: "modelproxy",
                url: "https://iris.test",
                issuer: "https://auth.test/realms/main",
                clientId: "lathe",
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

/** A promise and the function that settles it. */
function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * A gateway whose status stream the test writes to: `send` delivers one
 * event on the open stream and `end` closes it from the gateway's side.
 * `nextOpen` and `nextCancel` wait for the client to open or drop a stream.
 */
function liveGateway() {
  const encoder = new TextEncoder();
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let opened = signal();
  let cancelled = signal();
  const live = {
    opens: 0,
    reply: (request: HttpClientRequest.HttpClientRequest) => {
      if (new URL(request.url).pathname !== "/api/status/stream") return statusReply();
      live.opens += 1;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          stream = controller;
        },
        cancel: () => {
          const cancel = cancelled;
          cancelled = signal();
          cancel.resolve();
        },
      });
      const open = opened;
      opened = signal();
      open.resolve();
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
    /** Delivers every status in one read, as a busy gateway's burst would arrive. */
    send: (...statuses: ReadonlyArray<unknown>) =>
      stream?.enqueue(
        encoder.encode(
          statuses.map((next) => `event: status\ndata: ${JSON.stringify(next)}\n\n`).join(""),
        ),
      ),
    end: () => stream?.close(),
    nextOpen: () => {
      const { promise } = opened;
      return Effect.promise(() => promise);
    },
    nextCancel: () => {
      const { promise } = cancelled;
      return Effect.promise(() => promise);
    },
  };
  return live;
}

/** The first published source list whose gateway snapshot matches. */
const firstWhere = (
  sources: UsageLimitSources.UsageLimitSources["Service"],
  matches: (snapshot: UsageLimitSourceSnapshot) => boolean,
) =>
  sources.streamChanges.pipe(
    Stream.filter((snapshots) => snapshots[0] !== undefined && matches(snapshots[0])),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

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

  it.effect("follows the gateway's status stream while a client watches, and only then", () => {
    const live = liveGateway();
    const { layer } = harness({ gateway: live.reply });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      expect(live.opens).toBe(0);

      const watching = yield* Scope.make();
      const opened = live.nextOpen();
      yield* sources.watch.pipe(Scope.provide(watching));
      yield* opened;
      live.send({ ...status, inflightTotal: 4 });
      const [followed] = yield* firstWhere(sources, (s) => s.proxy?.inflightTotal === 4);
      expect(followed?.error).toBeUndefined();
      expect(followed?.proxy?.routes).toEqual([kimi]);

      const closed = live.nextCancel();
      yield* Scope.close(watching, Exit.void);
      yield* closed;
      expect(live.opens).toBe(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("marks a gateway live only while its status stream is open", () => {
    const live = liveGateway();
    const { layer } = harness({ gateway: live.reply });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      expect((yield* sources.current)[0]?.proxy?.following).toBeUndefined();

      const watching = yield* Scope.make();
      const opened = live.nextOpen();
      yield* sources.watch.pipe(Scope.provide(watching));
      yield* opened;
      live.send({ ...status, inflightTotal: 4 });
      yield* firstWhere(sources, (s) => s.proxy?.following === true);

      // An interval read while the stream is open does not take the mark away.
      yield* refreshThroughRetry(sources);
      expect((yield* sources.current)[0]?.proxy?.following).toBe(true);

      const closed = live.nextCancel();
      yield* Scope.close(watching, Exit.void);
      yield* closed;
      yield* firstWhere(sources, (s) => s.proxy?.following === undefined);
    }).pipe(Effect.provide(layer));
  });

  it.effect("publishes a busy gateway's latest status at most every two seconds", () => {
    const live = liveGateway();
    const { layer } = harness({ gateway: live.reply });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const published: Array<number | undefined> = [];
      yield* sources.streamChanges.pipe(
        Stream.runForEach((snapshots) =>
          Effect.sync(() => void published.push(snapshots[0]?.proxy?.inflightTotal)),
        ),
        Effect.forkScoped,
      );
      const opened = live.nextOpen();
      yield* sources.watch;
      yield* opened;

      live.send({ ...status, inflightTotal: 1 });
      yield* firstWhere(sources, (s) => s.proxy?.inflightTotal === 1);
      live.send({ ...status, inflightTotal: 2 }, { ...status, inflightTotal: 3 });
      // The burst reaches the follower through the body stream, outside the
      // test clock. Either it is already held until the interval ends, or it
      // arrives after the interval and goes out at once; both publish 3.
      yield* TestClock.adjust("2 seconds");
      yield* firstWhere(sources, (s) => s.proxy?.inflightTotal === 3);
      expect(published).not.toContain(2);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("picks the stream back up when the gateway closes it", () => {
    const live = liveGateway();
    const { layer } = harness({ gateway: live.reply });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const first = live.nextOpen();
      yield* sources.watch;
      yield* first;
      live.send(status);
      yield* firstWhere(sources, (s) => s.proxy?.following === true);

      const second = live.nextOpen();
      live.end();
      // The close reaches the follower through the body stream, outside the
      // test clock. Dropping the live mark is its last step before it waits
      // to reopen, so the clock moves only once it is waiting.
      yield* firstWhere(sources, (s) => s.proxy?.following === undefined);
      yield* TestClock.adjust("1 second");
      yield* second;
      live.send({ ...status, queueDepth: 2 });
      yield* firstWhere(sources, (s) => s.proxy?.queueDepth === 2);
      expect(live.opens).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("reads a watched gateway on a short cadence when it has no stream", () => {
    const reads = { status: 0 };
    const { layer } = harness({
      gateway: (request) => {
        if (new URL(request.url).pathname === "/api/status/stream") {
          return new Response("404 page not found", { status: 404 });
        }
        reads.status += 1;
        return Response.json({ ...status, inflightTotal: reads.status });
      },
    });
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* refreshThroughRetry(sources);
      const before = reads.status;
      yield* sources.watch;
      yield* firstWhere(sources, (s) => s.proxy?.inflightTotal === before + 1);
      yield* TestClock.adjust("5 seconds");
      yield* firstWhere(sources, (s) => s.proxy?.inflightTotal === before + 2);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("keeps malformed source URLs encodable for config subscribers", () =>
    Effect.gen(function* () {
      const sources = yield* UsageLimitSources.make;
      yield* sources.refresh;
      const snapshots = yield* sources.current;
      expect(snapshots.map((source) => source.label)).toEqual([
        "local-hub",
        "opaque-hub",
        "Named hub",
        "hub.test:8317",
        "Usage limit source",
      ]);
      expect(() =>
        encodeConfigEvent({
          version: 1,
          type: "usageLimitSourcesUpdated",
          payload: { sources: snapshots },
        }),
      ).not.toThrow();
      expect(snapshots.every((source) => source.error === "No management key configured.")).toBe(
        true,
      );
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          usageLimitSources: {
            [UsageLimitSourceId.make("local-hub")]: {
              kind: "cliproxy",
              url: "localhost:8317",
              managementKey: "",
              enabled: true,
            },
            [UsageLimitSourceId.make("opaque-hub")]: {
              kind: "cliproxy",
              url: "file:///tmp/hub",
              managementKey: "",
              enabled: true,
            },
            [UsageLimitSourceId.make("named-hub")]: {
              kind: "cliproxy",
              url: "localhost:8317",
              label: "Named hub",
              managementKey: "",
              enabled: true,
            },
            [UsageLimitSourceId.make("valid-hub")]: {
              kind: "cliproxy",
              url: "https://hub.test:8317",
              managementKey: "",
              enabled: true,
            },
            [UsageLimitSourceId.make(" ")]: {
              kind: "cliproxy",
              url: "localhost:8317",
              managementKey: "",
              enabled: true,
            },
          },
        }),
        Layer.mock(BackgroundPolicy.BackgroundPolicy)({
          shouldRunScopeWork: () => Effect.succeed(false),
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected network request")),
        ),
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: () => Effect.succeed(Option.none()),
        }),
        NodeCrypto.layer,
      ]),
      Effect.scoped,
    ),
  );
});
