import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { makeModelproxyApi, mapModelproxyStatus, ModelproxyStatus } from "./modelproxyApi.ts";

const now = Date.parse("2026-09-23T12:00:00Z");
const iso = (offsetMs: number) => DateTime.formatIso(DateTime.makeUnsafe(now + offsetMs));

/** The wire payload as modelproxy sends it, including fields T3 ignores. */
const raw = {
  current: "james-max",
  threshold: 0.9,
  fableThreshold: 0.85,
  apiCapUsd: 0,
  spendWindow: "day",
  totalSpendUsd: 0,
  openaiCapUsd: 0,
  openaiSpendUsd: 0,
  openrouterCapUsd: -1,
  openrouterSpendUsd: 3.4,
  openrouterWindow: "day",
  inflightTotal: 2,
  queueDepth: 0,
  maxPerAccount: 0,
  maxTotal: 0,
  rolling: {
    windowSeconds: 300,
    count: 10,
    c429: 0,
    c502: 0,
    c503: 0,
    c529: 0,
    p50Ms: 1,
    p95Ms: 2,
    p99Ms: 3,
  },
  forecast: {
    workloadRatePerHour: 0.14,
    fableRatePerHour: 0.09,
    spendRateUsdPerHour: 0.8,
    apiSpendRateUsdPerHour: 0,
    fleet: { kind: "at", at: iso(4 * 3_600_000) },
    fable: { kind: "resetsFirst", at: iso(96 * 3_600_000) },
    api: { kind: "disabled" },
  },
  accounts: [
    {
      name: "james-max",
      type: "oauth",
      provider: "anthropic",
      current: true,
      disabled: false,
      priority: 1,
      util5h: 0.62,
      has5h: true,
      reset5h: iso(2 * 3_600_000),
      util7d: 0.41,
      has7d: true,
      reset7d: iso(100 * 3_600_000),
      perModel: { fable: 0.58 },
      perModelReset: { fable: iso(100 * 3_600_000) },
      spendUsd: 0,
      inflight: 2,
      pinnedSessions: 1,
    },
    {
      name: "zeus-pro",
      type: "oauth",
      provider: "anthropic",
      current: false,
      disabled: false,
      priority: 2,
      util5h: 0.96,
      has5h: true,
      reset5h: iso(1.7 * 3_600_000),
      util7d: 0.58,
      has7d: true,
      reset7d: iso(90 * 3_600_000),
      spendUsd: 0,
      inflight: 0,
      pinnedSessions: 0,
      coolingUntil: iso(20_000),
    },
    {
      name: "codex-james",
      type: "oauth",
      provider: "openai",
      current: false,
      disabled: false,
      priority: 1,
      util5h: 0.35,
      has5h: true,
      reset5h: iso(3 * 3_600_000),
      util7d: 0.71,
      has7d: true,
      reset7d: iso(76 * 3_600_000),
      credits: true,
      spendUsd: 0,
      inflight: 0,
      pinnedSessions: 0,
    },
    {
      name: "stale",
      type: "oauth",
      provider: "anthropic",
      current: false,
      disabled: false,
      priority: 9,
      util5h: 0,
      has5h: false,
      util7d: 0,
      has7d: false,
      spendUsd: 0,
      inflight: 0,
      pinnedSessions: 0,
      health: { state: "reauthentication_required", recovery: "modelproxy login stale" },
    },
    {
      name: "openrouter-main",
      type: "apikey",
      provider: "openrouter",
      current: false,
      disabled: false,
      priority: 5,
      util5h: 0,
      has5h: false,
      util7d: 0,
      has7d: false,
      spendUsd: 3.4,
      capUsd: -1,
      spendWindow: "day",
      inflight: 0,
      pinnedSessions: 0,
    },
  ],
  events: [],
  generatedAt: iso(0),
};
const status = Schema.decodeUnknownSync(ModelproxyStatus)(raw);

describe("mapModelproxyStatus", () => {
  const mapped = mapModelproxyStatus(status, { checkedAt: iso(0), nowMs: now });

  it("keeps subscription accounts with their windows as percentages", () => {
    expect(mapped.accounts.map((account) => account.id)).toEqual([
      "james-max",
      "zeus-pro",
      "codex-james",
      "stale",
    ]);
    const james = mapped.accounts[0]!;
    expect(String(james.driver)).toBe("claudeAgent");
    expect(james.usageLimits.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ["five_hour", 62],
      ["seven_day", 41],
      ["seven_day_fable", 58],
    ]);
    expect(james.usageLimits.windows[0]?.resetsAt).toBe(iso(2 * 3_600_000));
    expect(String(mapped.accounts[2]!.driver)).toBe("codex");
  });

  it("derives the gateway's own account state", () => {
    expect(mapped.accounts.map((account) => account.proxy?.state)).toEqual([
      "live",
      "cooling",
      "ready",
      "reauthentication",
    ]);
    expect(mapped.accounts[1]!.proxy?.coolingUntil).toBe(iso(20_000));
    expect(mapped.accounts[2]!.proxy?.credits).toBe(true);
    expect(mapped.accounts[0]!.proxy?.inflight).toBe(2);
  });

  it("reports a window never observed as unavailable rather than 0%", () => {
    const stale = mapped.accounts[3]!;
    expect(stale.usageLimits.windows).toEqual([]);
    expect(stale.usageLimits.unavailable?.reason).toBe("probeFailed");
  });

  it("summarises the gateway for the header widget", () => {
    expect(mapped.proxy.current).toBe("james-max");
    expect(mapped.proxy.rotationThresholdPercent).toBe(90);
    expect(mapped.proxy.modelThresholdPercent).toBe(85);
    expect(mapped.proxy.runway).toEqual({ kind: "at", at: iso(4 * 3_600_000) });
    expect(mapped.proxy.inflightTotal).toBe(2);
    expect(mapped.proxy.fallback).toEqual([
      { name: "openrouter-main", provider: "openrouter", spendUsd: 3.4, window: "day" },
    ]);
  });
});

describe("makeModelproxyApi", () => {
  it.effect("reads the status endpoint with the bearer token", () =>
    Effect.gen(function* () {
      let authorization: string | undefined;
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          authorization = request.headers.authorization;
          expect(new URL(request.url).pathname).toBe("/api/status");
          return HttpClientResponse.fromWeb(request, Response.json(raw));
        }),
      );
      const api = yield* makeModelproxyApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const result = yield* api.readStatus("https://iris.test", "access-token");
      expect(authorization).toBe("Bearer access-token");
      expect(result.current).toBe("james-max");
      expect(result.accounts).toHaveLength(5);
    }),
  );

  it.effect("names an expired or rejected token so the caller can re-authenticate", () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.sync(() =>
          HttpClientResponse.fromWeb(request, new Response("RBAC: access denied", { status: 403 })),
        ),
      );
      const api = yield* makeModelproxyApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const result = yield* api.readStatus("https://iris.test", "stale").pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.unauthorized).toBe(true);
        expect(result.failure.detail).toContain("403");
      }
    }),
  );
});
