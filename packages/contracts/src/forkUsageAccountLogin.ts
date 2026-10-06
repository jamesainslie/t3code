/**
 * Fork-only contracts for logging a modelproxy gateway's pooled account in
 * again from T3 Code. The gateway runs the OAuth flow and keeps every
 * secret; T3 relays the session view so the header pill can show the consent
 * link (Anthropic accounts paste back the code it shows) or the device code
 * (Codex accounts approve it on OpenAI's site).
 *
 * Upstream contracts reach this module through one field on the gateway
 * status and one RPC, so upstream merges stay mechanical.
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { UsageLimitSourceId } from "./usageLimitSourceId.ts";

export const UsageLimitSourceAccountLoginState = Schema.Literals([
  "awaiting_code",
  "awaiting_approval",
  "exchanging",
  "completed",
  "failed",
  "expired",
]);
export type UsageLimitSourceAccountLoginState = typeof UsageLimitSourceAccountLoginState.Type;

/** One account's login on the gateway, as the gateway reports it. */
export const UsageLimitSourceAccountLogin = Schema.Struct({
  /** `accounts[].id` of the account being logged in. */
  account: TrimmedNonEmptyString,
  sessionId: TrimmedNonEmptyString,
  mode: Schema.Literals(["paste", "device"]),
  state: UsageLimitSourceAccountLoginState,
  /** Paste mode: the consent page, which shows the code to paste back. */
  authorizeUrl: Schema.optional(TrimmedNonEmptyString),
  /** Device mode: the code to enter, and where. */
  userCode: Schema.optional(TrimmedNonEmptyString),
  verificationUrl: Schema.optional(TrimmedNonEmptyString),
  expiresAt: IsoDateTime,
  /**
   * The gateway's stable failure category (`bad_code`, `identity_mismatch`,
   * ...); a completed login may carry `save_failed`.
   */
  errorCode: Schema.optional(TrimmedNonEmptyString),
  error: Schema.optional(TrimmedNonEmptyString),
});
export type UsageLimitSourceAccountLogin = typeof UsageLimitSourceAccountLogin.Type;

const Target = { sourceId: UsageLimitSourceId, account: TrimmedNonEmptyString };

/**
 * Drive one account's login. `start` replaces any login the account already
 * has; `submit` sends the code a paste-mode consent page showed.
 */
export const UsageLimitSourceAccountLoginInput = Schema.Union([
  Schema.Struct({ ...Target, action: Schema.Literal("start") }),
  Schema.Struct({ ...Target, action: Schema.Literal("submit"), code: TrimmedNonEmptyString }),
  Schema.Struct({ ...Target, action: Schema.Literal("cancel") }),
]);
export type UsageLimitSourceAccountLoginInput = typeof UsageLimitSourceAccountLoginInput.Type;

/** The login after the action; absent once cancelled. */
export const UsageLimitSourceAccountLoginResult = Schema.Struct({
  login: Schema.optional(UsageLimitSourceAccountLogin),
});
export type UsageLimitSourceAccountLoginResult = typeof UsageLimitSourceAccountLoginResult.Type;
