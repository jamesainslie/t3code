import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  NonNegativeInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";
import { UsageLimitSourceId } from "./usageLimitSourceId.ts";

/**
 * One rolling quota window a subscription provider reports for the signed-in
 * account, e.g. Claude's five-hour session or Codex's weekly allowance.
 *
 * `id` is stable per provider (`five_hour`, `seven_day_opus`, `primary`) so a
 * sparse turn-driven update lands on the same row a full probe produced.
 * `kind` only orders and labels the bar.
 */
export const ServerProviderUsageWindow = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: Schema.Literals(["session", "weekly", "monthly", "other"]),
  label: TrimmedNonEmptyString,
  usedPercent: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  resetsAt: Schema.optional(IsoDateTime),
  windowDurationMins: Schema.optional(NonNegativeInt),
});
export type ServerProviderUsageWindow = typeof ServerProviderUsageWindow.Type;

/**
 * Reset credits a provider banks on the account. Codex grants these when it
 * has rate-limited the user unfairly; redeeming one clears the current
 * windows. Only present when the provider reports them at all.
 */
export const ServerProviderResetCredits = Schema.Struct({
  availableCount: NonNegativeInt,
  nextExpiresAt: Schema.optional(IsoDateTime),
  /** Pins hub redemption to the displayed credit, including retries from another client. */
  nextCreditId: Schema.optional(TrimmedNonEmptyString),
});
export type ServerProviderResetCredits = typeof ServerProviderResetCredits.Type;

/**
 * Subscription usage the provider knows about the signed-in account.
 *
 * `unavailable` distinguishes an account that can never report windows (API
 * key, Bedrock) from a probe that failed this time, so clients can keep the
 * last good bars for the latter and clear them for the former.
 */
export const ServerProviderUsageLimits = Schema.Struct({
  checkedAt: IsoDateTime,
  windows: ForwardCompatibleArray(ServerProviderUsageWindow),
  resetCredits: Schema.optional(ServerProviderResetCredits),
  unavailable: Schema.optional(
    Schema.Struct({
      reason: Schema.Literals(["unsupported", "probeFailed"]),
      message: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
});
export type ServerProviderUsageLimits = typeof ServerProviderUsageLimits.Type;

/**
 * What an adapter reports when its runtime pushes a rate-limit update during
 * a turn. Sparse by contract: Claude's `rate_limit_event` names one window at
 * a time and Codex documents its notification as a partial. Windows merge by
 * `id` onto the instance's published snapshot; omitted windows are unchanged.
 */
export const ProviderUsageLimitsUpdate = Schema.Struct({
  windows: Schema.Array(ServerProviderUsageWindow),
});
export type ProviderUsageLimitsUpdate = typeof ProviderUsageLimitsUpdate.Type;

/**
 * What a modelproxy gateway says one pooled account is doing right now. The
 * vocabulary is the gateway's own: `live` is the account serving traffic,
 * `ready` may be selected, `cooling` is parked after a rejection, `paused`
 * is disabled by the operator, and the last two are terminal conditions
 * that need the operator to act.
 */
export const UsageLimitSourceProxyAccountState = Schema.Literals([
  "live",
  "ready",
  "cooling",
  "paused",
  "reauthentication",
  "suspended",
]);
export type UsageLimitSourceProxyAccountState = typeof UsageLimitSourceProxyAccountState.Type;

export const UsageLimitSourceProxyAccount = Schema.Struct({
  state: UsageLimitSourceProxyAccountState,
  coolingUntil: Schema.optional(IsoDateTime),
  /** The upstream keeps serving from purchased credits once the windows are spent. */
  credits: Schema.optional(Schema.Boolean),
  inflight: NonNegativeInt,
});
export type UsageLimitSourceProxyAccount = typeof UsageLimitSourceProxyAccount.Type;

/**
 * One account a usage-limit source reports on. `driver` is the provider the
 * account belongs to, for the icon and colour clients already have; the
 * account itself is not something this environment can run turns on.
 */
export const UsageLimitSourceAccount = Schema.Struct({
  id: TrimmedNonEmptyString,
  driver: ProviderDriverKind,
  /** The signed-in address, when the source names one; clients blur it like provider auth. */
  email: Schema.optional(TrimmedNonEmptyString),
  /** Plan as the matching provider would label it (`ChatGPT Pro 20x Subscription`). */
  plan: Schema.optional(TrimmedNonEmptyString),
  usageLimits: ServerProviderUsageLimits,
  /** Present on `modelproxy` sources only. */
  proxy: Schema.optional(UsageLimitSourceProxyAccount),
});
export type UsageLimitSourceAccount = typeof UsageLimitSourceAccount.Type;

/** Mirrors modelproxy's forecast runway kinds. */
export const UsageLimitSourceRunway = Schema.Struct({
  kind: Schema.Literals(["at", "idle", "beyondHorizon", "resetsFirst", "unknown", "disabled"]),
  at: Schema.optional(IsoDateTime),
});
export type UsageLimitSourceRunway = typeof UsageLimitSourceRunway.Type;

/**
 * Where the server stands with the gateway's sign-in. `pending` carries the
 * device code the user must enter; it is published so any client of this
 * environment can show it, not only the one that started the flow.
 */
export const UsageLimitSourceAuthState = Schema.Union([
  Schema.Struct({ state: Schema.Literal("signedOut") }),
  Schema.Struct({ state: Schema.Literal("signedIn") }),
  Schema.Struct({
    state: Schema.Literal("pending"),
    userCode: TrimmedNonEmptyString,
    verificationUrl: TrimmedNonEmptyString,
    /** The URL with the code already filled in, when the issuer offers one. */
    verificationUrlComplete: Schema.optional(TrimmedNonEmptyString),
    expiresAt: IsoDateTime,
  }),
]);
export type UsageLimitSourceAuthState = typeof UsageLimitSourceAuthState.Type;

/** A metered account the gateway spills to once the subscriptions are spent. */
export const UsageLimitSourceProxyFallback = Schema.Struct({
  name: TrimmedNonEmptyString,
  provider: TrimmedNonEmptyString,
  spendUsd: Schema.Number,
  /** Absent when the gateway imposes no cap. */
  capUsd: Schema.optional(Schema.Number),
  /** `day` or `month`. */
  window: Schema.optional(TrimmedNonEmptyString),
});
export type UsageLimitSourceProxyFallback = typeof UsageLimitSourceProxyFallback.Type;

/**
 * A model name the gateway serves from somewhere other than its own name,
 * e.g. `kimi-k3` answered by `moonshotai/kimi-k3` on OpenRouter. Only model
 * routes are published: a fallback route's `from` is a model the picker
 * already offers.
 */
export const UsageLimitSourceProxyRoute = Schema.Struct({
  /** The name a client requests. */
  from: TrimmedNonEmptyString,
  /** The upstream model that serves it. */
  to: TrimmedNonEmptyString,
  /** The upstream family, e.g. `openrouter`, `openai`, `anthropic`. */
  provider: TrimmedNonEmptyString,
  /** The gateway's route kind; absent means a model route. */
  kind: Schema.optional(TrimmedNonEmptyString),
});
export type UsageLimitSourceProxyRoute = typeof UsageLimitSourceProxyRoute.Type;

/**
 * Gateway-wide state from a `modelproxy` source: what the header widget
 * needs beyond the per-account windows.
 */
export const UsageLimitSourceProxyStatus = Schema.Struct({
  auth: UsageLimitSourceAuthState,
  /** `accounts[].id` of the account serving traffic, when one is. */
  current: Schema.optional(TrimmedNonEmptyString),
  /** Utilisation at which the gateway rotates off the shared windows, 0-100. */
  rotationThresholdPercent: Schema.optional(Schema.Number),
  /** The same for per-model weekly buckets. */
  modelThresholdPercent: Schema.optional(Schema.Number),
  runway: Schema.optional(UsageLimitSourceRunway),
  fallback: Schema.optional(ForwardCompatibleArray(UsageLimitSourceProxyFallback)),
  inflightTotal: Schema.optional(NonNegativeInt),
  queueDepth: Schema.optional(NonNegativeInt),
  /** Absent from gateways that predate route publishing. */
  routes: Schema.optional(ForwardCompatibleArray(UsageLimitSourceProxyRoute)),
});
export type UsageLimitSourceProxyStatus = typeof UsageLimitSourceProxyStatus.Type;

/**
 * The published state of one configured `usageLimitSources` entry. A source
 * that could not be read keeps `error` beside an empty account list rather
 * than vanishing, so the user can see it is configured but failing.
 */
export const UsageLimitSourceSnapshot = Schema.Struct({
  id: UsageLimitSourceId,
  kind: Schema.Literals(["cliproxy", "modelproxy"]),
  label: TrimmedNonEmptyString,
  checkedAt: IsoDateTime,
  accounts: ForwardCompatibleArray(UsageLimitSourceAccount),
  error: Schema.optional(TrimmedNonEmptyString),
  /** Present on `modelproxy` sources, even while signed out. */
  proxy: Schema.optional(UsageLimitSourceProxyStatus),
});
export type UsageLimitSourceSnapshot = typeof UsageLimitSourceSnapshot.Type;

/** Drive a `modelproxy` source's sign-in. `start` is idempotent while a flow is pending. */
export const UsageLimitSourceAuthInput = Schema.Struct({
  sourceId: UsageLimitSourceId,
  action: Schema.Literals(["start", "cancel", "signOut"]),
});
export type UsageLimitSourceAuthInput = typeof UsageLimitSourceAuthInput.Type;

export const UsageLimitSourceSnapshots = ForwardCompatibleArray(UsageLimitSourceSnapshot);
export type UsageLimitSourceSnapshots = typeof UsageLimitSourceSnapshots.Type;

export const UsageLimitSourceConsumeResetCreditInput = Schema.Struct({
  sourceId: UsageLimitSourceId,
  accountId: TrimmedNonEmptyString,
  creditId: TrimmedNonEmptyString,
});
export type UsageLimitSourceConsumeResetCreditInput =
  typeof UsageLimitSourceConsumeResetCreditInput.Type;

export const ProviderConsumeResetCreditInput = Schema.Union([
  Schema.Struct({ instanceId: ProviderInstanceId }),
  UsageLimitSourceConsumeResetCreditInput,
]);
export type ProviderConsumeResetCreditInput = typeof ProviderConsumeResetCreditInput.Type;

export class UsageLimitSourceError extends Schema.TaggedError<UsageLimitSourceError>()(
  "UsageLimitSourceError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** Mirrors Codex's own outcome set; other providers map onto it. */
export const ProviderConsumeResetCreditOutcome = Schema.Literals([
  "reset",
  "nothingToReset",
  "noCredit",
  "alreadyRedeemed",
]);
export type ProviderConsumeResetCreditOutcome = typeof ProviderConsumeResetCreditOutcome.Type;

export const ProviderConsumeResetCreditResult = Schema.Struct({
  outcome: ProviderConsumeResetCreditOutcome,
  /** Redemption succeeded, but a follow-up such as clearing the hub cooldown failed. */
  warning: Schema.optional(TrimmedNonEmptyString),
});
export type ProviderConsumeResetCreditResult = typeof ProviderConsumeResetCreditResult.Type;

/** A point-in-time view of one provider's limits, built for the /usage-limits panel. */
export const UsageLimitsReport = Schema.Struct({
  createdAt: IsoDateTime,
  accounts: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      driver: ProviderDriverKind,
      label: TrimmedNonEmptyString,
      plan: Schema.optional(TrimmedNonEmptyString),
      email: Schema.optional(TrimmedNonEmptyString),
      sourceLabel: Schema.optional(TrimmedNonEmptyString),
      instanceId: Schema.optional(ProviderInstanceId),
      resetCreditInput: Schema.optional(ProviderConsumeResetCreditInput),
      displayName: Schema.optional(Schema.String),
      accentColor: Schema.optional(Schema.String),
      limits: ServerProviderUsageLimits,
    }),
  ),
  notices: Schema.Array(Schema.String),
});
export type UsageLimitsReport = typeof UsageLimitsReport.Type;
