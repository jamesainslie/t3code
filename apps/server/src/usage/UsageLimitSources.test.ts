import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, UsageLimitSourceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

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

/**
 * A signed-in modelproxy source whose gateway answers until `gateway.up` is
 * cleared. The session is stored the way modelproxyAuth stores it and does
 * not expire, so no read goes near the issuer.
 */
function harness() {
  const gateway = { up: true };
  const secrets = new Map<string, Uint8Array>([
    [
      `usage-limit-source-${Buffer.from(sourceId, "utf8").toString("base64url")}-session`,
      new TextEncoder().encode(
        JSON.stringify({ accessToken: "token", expiresAt: "2099-01-01T00:00:00.000Z" }),
      ),
    ],
  ]);
  const http = HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(
        request,
        gateway.up ? Response.json(status) : new Response("upstream down", { status: 503 }),
      ),
    ),
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
          shouldRunScopeWork: () => Effect.succeed(false),
        }),
      ),
    ),
  );
  return { gateway, layer };
}

describe("UsageLimitSources", () => {
  it.effect("keeps the gateway's routes through a failed read", () => {
    const { gateway, layer } = harness();
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* sources.refresh;
      const [fresh] = yield* sources.current;
      expect(fresh?.proxy?.routes).toEqual([kimi]);

      // A routed model vanishing from the picker would silently reset every
      // thread that selected it, so a transient outage must not drop it.
      gateway.up = false;
      yield* sources.refresh;
      const [failed] = yield* sources.current;
      expect(failed?.error).toContain("503");
      expect(failed?.accounts).toEqual([]);
      expect(failed?.proxy?.routes).toEqual([kimi]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("has no routes when the first read fails", () => {
    const { gateway, layer } = harness();
    gateway.up = false;
    return Effect.gen(function* () {
      const sources = yield* UsageLimitSources.UsageLimitSources;
      yield* sources.refresh;
      const [failed] = yield* sources.current;
      expect(failed?.error).toContain("503");
      expect(failed?.proxy?.routes).toBeUndefined();
    }).pipe(Effect.provide(layer));
  });
});
