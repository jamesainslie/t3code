/**
 * modelproxy's dashboard status API, read as the signed-in operator, and its
 * mapping onto the usage-limit source shape clients already render. The
 * per-account vocabulary (live, ready, cooling, spent) is derived here the
 * same way modelproxy's own dashboard derives it, so T3 and the gateway
 * never disagree about what an account is doing.
 *
 * @module usage/modelproxyApi
 */
import {
  ProviderDriverKind,
  type ServerProviderUsageWindow,
  type UsageLimitSourceAccount,
  type UsageLimitSourceProxyAccountState,
  type UsageLimitSourceProxyStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "../provider/providerUsageLimits.ts";

const Runway = Schema.Struct({
  kind: Schema.Literals(["at", "idle", "beyondHorizon", "resetsFirst", "unknown", "disabled"]),
  at: Schema.optional(Schema.String),
});
const Account = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  provider: Schema.String,
  current: Schema.Boolean,
  disabled: Schema.Boolean,
  util5h: Schema.Number,
  has5h: Schema.Boolean,
  reset5h: Schema.optional(Schema.String),
  util7d: Schema.Number,
  has7d: Schema.Boolean,
  reset7d: Schema.optional(Schema.String),
  perModel: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  perModelReset: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  credits: Schema.optional(Schema.Boolean),
  spendUsd: Schema.Number,
  capUsd: Schema.optional(Schema.Number),
  spendWindow: Schema.optional(Schema.String),
  inflight: Schema.Number,
  coolingUntil: Schema.optional(Schema.String),
  circuits: Schema.optional(Schema.Array(Schema.Struct({ state: Schema.String }))),
  health: Schema.optional(Schema.Struct({ state: Schema.String })),
});
/** Only the fields T3 reads; the payload carries much more and may grow. */
export const ModelproxyStatus = Schema.Struct({
  current: Schema.String,
  threshold: Schema.Number,
  fableThreshold: Schema.optional(Schema.Number),
  inflightTotal: Schema.Number,
  queueDepth: Schema.Number,
  forecast: Schema.Struct({ fleet: Runway }),
  accounts: Schema.Array(Account),
});
export type ModelproxyStatus = typeof ModelproxyStatus.Type;
type ModelproxyAccount = typeof Account.Type;

const decodeStatus = Schema.decodeUnknownEffect(ModelproxyStatus);

export class ModelproxyReadError extends Schema.TaggedError<ModelproxyReadError>()(
  "ModelproxyReadError",
  {
    detail: Schema.String,
    /** The gateway rejected the token, so a fresh sign-in is needed rather than a retry. */
    unauthorized: Schema.optional(Schema.Boolean),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;

function driverFor(provider: string): ProviderDriverKind | null {
  switch (provider) {
    case "anthropic":
    case "":
      return ProviderDriverKind.make("claudeAgent");
    case "openai":
      return ProviderDriverKind.make("codex");
    default:
      return null;
  }
}

function elapsed(reset: string | undefined, nowMs: number): boolean {
  if (!reset) return false;
  const at = Date.parse(reset);
  return Number.isFinite(at) && at <= nowMs;
}

function windows(account: ModelproxyAccount, nowMs: number): ServerProviderUsageWindow[] {
  const out: ServerProviderUsageWindow[] = [];
  // A window whose reset has passed rolled over to full headroom; the
  // gateway still carries the last observation, so 0% is the honest figure.
  const util = (value: number, reset: string | undefined) =>
    elapsed(reset, nowMs) ? 0 : clampPercent(Math.round(value * 10_000) / 100);
  if (account.has5h) {
    out.push({
      id: "five_hour",
      kind: "session",
      label: "Session",
      windowDurationMins: SESSION_MINS,
      usedPercent: util(account.util5h, account.reset5h),
      ...(account.reset5h ? { resetsAt: account.reset5h } : {}),
    });
  }
  if (account.has7d) {
    out.push({
      id: "seven_day",
      kind: "weekly",
      label: "Weekly",
      windowDurationMins: WEEK_MINS,
      usedPercent: util(account.util7d, account.reset7d),
      ...(account.reset7d ? { resetsAt: account.reset7d } : {}),
    });
  }
  for (const [family, value] of Object.entries(account.perModel ?? {})) {
    const reset = account.perModelReset?.[family];
    out.push({
      id: `seven_day_${family.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      kind: "weekly",
      label: `Weekly · ${family[0]?.toUpperCase()}${family.slice(1)}`,
      windowDurationMins: WEEK_MINS,
      usedPercent: util(value, reset),
      ...(reset ? { resetsAt: reset } : {}),
    });
  }
  return out;
}

function accountState(
  account: ModelproxyAccount,
  nowMs: number,
): UsageLimitSourceProxyAccountState {
  if (account.disabled) return "paused";
  if (account.health?.state === "reauthentication_required") return "reauthentication";
  if (account.health?.state === "entitlement_suspended") return "suspended";
  if (account.coolingUntil && !elapsed(account.coolingUntil, nowMs)) return "cooling";
  // An open circuit routes traffic around the account, which is what
  // cooling amounts to from the outside.
  if (account.circuits?.some((circuit) => circuit.state === "open")) return "cooling";
  return account.current ? "live" : "ready";
}

/**
 * Subscription accounts become source accounts with the gateway's state
 * attached; metered API-key accounts have no windows to show and appear
 * only as fallbacks in the proxy summary.
 */
export function mapModelproxyStatus(
  status: ModelproxyStatus,
  input: { readonly checkedAt: string; readonly nowMs: number },
): { accounts: UsageLimitSourceAccount[]; proxy: Omit<UsageLimitSourceProxyStatus, "auth"> } {
  const accounts: UsageLimitSourceAccount[] = [];
  const fallback: NonNullable<UsageLimitSourceProxyStatus["fallback"]>[number][] = [];
  for (const account of status.accounts) {
    if (account.type === "apikey") {
      fallback.push({
        name: account.name,
        provider: account.provider || "anthropic",
        spendUsd: account.spendUsd,
        ...(account.capUsd !== undefined && account.capUsd > 0 ? { capUsd: account.capUsd } : {}),
        ...(account.spendWindow ? { window: account.spendWindow } : {}),
      });
      continue;
    }
    const driver = driverFor(account.provider);
    if (driver === null) continue;
    const observed = windows(account, input.nowMs);
    accounts.push({
      id: account.name,
      driver,
      usageLimits:
        observed.length > 0
          ? makeUsageLimits({ checkedAt: input.checkedAt, windows: observed })
          : makeUnavailableUsageLimits({
              checkedAt: input.checkedAt,
              reason: "probeFailed",
              message: "The gateway has not observed this account's windows yet.",
            }),
      proxy: {
        state: accountState(account, input.nowMs),
        ...(account.coolingUntil && !elapsed(account.coolingUntil, input.nowMs)
          ? { coolingUntil: account.coolingUntil }
          : {}),
        ...(account.credits ? { credits: true } : {}),
        inflight: Math.max(0, Math.round(account.inflight)),
      },
    });
  }
  const current = accounts.find((account) => account.id === status.current);
  return {
    accounts,
    proxy: {
      ...(current ? { current: current.id } : {}),
      rotationThresholdPercent: clampPercent(status.threshold * 100),
      ...(status.fableThreshold !== undefined
        ? { modelThresholdPercent: clampPercent(status.fableThreshold * 100) }
        : {}),
      runway: {
        kind: status.forecast.fleet.kind,
        ...(status.forecast.fleet.at ? { at: status.forecast.fleet.at } : {}),
      },
      ...(fallback.length > 0 ? { fallback } : {}),
      inflightTotal: Math.max(0, Math.round(status.inflightTotal)),
      queueDepth: Math.max(0, Math.round(status.queueDepth)),
    },
  };
}

export const makeModelproxyApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const readStatus = Effect.fn("ModelproxyApi.readStatus")(function* (
    baseUrl: string,
    accessToken: string,
  ): Effect.fn.Return<ModelproxyStatus, ModelproxyReadError> {
    const url = yield* Effect.try({
      try: () => new URL("/api/status", baseUrl).toString(),
      catch: () => new ModelproxyReadError({ detail: "The gateway URL is not valid." }),
    });
    const response = yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${accessToken}`),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new ModelproxyReadError({ detail: "The gateway did not answer." })),
      );
    if (response.status === 401 || response.status === 403) {
      return yield* new ModelproxyReadError({
        detail: `The gateway rejected the session (HTTP ${response.status}).`,
        unauthorized: true,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new ModelproxyReadError({
        detail: `The gateway status request failed (HTTP ${response.status}).`,
      });
    }
    const body = yield* response.json.pipe(
      Effect.mapError(
        () => new ModelproxyReadError({ detail: "The gateway status was not JSON." }),
      ),
    );
    return yield* decodeStatus(body).pipe(
      Effect.mapError(
        () => new ModelproxyReadError({ detail: "The gateway status was not understood." }),
      ),
    );
  });

  return { readStatus };
});

export type ModelproxyApi = Effect.Success<typeof makeModelproxyApi>;
