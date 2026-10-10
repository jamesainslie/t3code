/**
 * Fork-only: logging a modelproxy gateway's pooled account in again from T3
 * Code. The gateway runs the OAuth flow and keeps the verifier and every
 * token (`/api/accounts/{name}/login`); this module relays its session view,
 * keeps the latest one per account for the published snapshot, and polls a
 * device-code login while the user approves it elsewhere, so every client of
 * this environment sees the same panel without polling the gateway itself.
 *
 * Each change publishes the source id; `UsageLimitSources` re-reads the
 * gateway on it, which is also how a finished login turns the account's row
 * back to ready.
 *
 * @module usage/modelproxyAccountLogin
 */
import {
  UsageLimitSourceError,
  type UsageLimitSourceAccountLogin,
  type UsageLimitSourceAccountLoginInput,
  type UsageLimitSourceAccountLoginResult,
  type UsageLimitSourceAccountLoginState,
  type UsageLimitSourceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

/** How often a device login is re-read while the user approves it. */
const POLL_EVERY = Duration.seconds(3);
/** A finished login stays on the snapshot this long, so a client sees how it ended. */
const KEEP_FINISHED_MS = 60_000;

const STATES: ReadonlySet<string> = new Set<UsageLimitSourceAccountLoginState>([
  "awaiting_code",
  "awaiting_approval",
  "exchanging",
  "completed",
  "failed",
  "expired",
]);

const terminal = (state: UsageLimitSourceAccountLoginState) =>
  state === "completed" || state === "failed" || state === "expired";

/** The gateway's session view (internal/relogin.View). */
const GatewayView = Schema.Struct({
  sessionId: Schema.String,
  account: Schema.String,
  mode: Schema.Literals(["paste", "device"]),
  state: Schema.String,
  authorizeUrl: Schema.optional(Schema.String),
  userCode: Schema.optional(Schema.String),
  verificationUrl: Schema.optional(Schema.String),
  expiresAt: Schema.String,
  errorCode: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
const GatewayError = Schema.Struct({
  error: Schema.String,
  session: Schema.optional(GatewayView),
});
const decodeView = Schema.decodeUnknownEffect(GatewayView);
const decodeError = Schema.decodeUnknownEffect(GatewayError);

const nonEmpty = (value: string | undefined) => (value && value.trim() !== "" ? value : undefined);

/** The gateway's view in contract form; a state this build does not know reads as failed. */
function toLogin(view: typeof GatewayView.Type): UsageLimitSourceAccountLogin {
  const known = STATES.has(view.state);
  const expires = Date.parse(view.expiresAt);
  const optional = {
    authorizeUrl: nonEmpty(view.authorizeUrl),
    userCode: nonEmpty(view.userCode),
    verificationUrl: nonEmpty(view.verificationUrl),
    errorCode: nonEmpty(view.errorCode),
    error: known ? nonEmpty(view.error) : `The gateway reported an unknown state (${view.state}).`,
  };
  return {
    account: view.account,
    sessionId: view.sessionId,
    mode: view.mode,
    state: known ? (view.state as UsageLimitSourceAccountLoginState) : "failed",
    expiresAt: Number.isFinite(expires)
      ? DateTime.formatIso(DateTime.makeUnsafe(expires))
      : view.expiresAt,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
}

/** Where to reach the gateway, and the operator's token for it. */
export interface ModelproxyLoginTarget {
  readonly baseUrl: string;
  readonly token: Effect.Effect<string, UsageLimitSourceError>;
}

interface Tracked {
  readonly login: UsageLimitSourceAccountLogin;
  /** When this build first saw the login finished. */
  readonly endedAtMs?: number;
}

export const makeModelproxyAccountLogin = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const scope = yield* Effect.scope;
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<UsageLimitSourceId>(),
    PubSub.shutdown,
  );
  /** sourceId -> account -> latest view. */
  const logins = new Map<string, Map<string, Tracked>>();
  /** One poll per account; `owner` lets a finishing poll tell its own slot from a successor's. */
  const polls = new Map<string, { readonly fiber: Fiber.Fiber<void>; readonly owner: object }>();
  const pollKey = (sourceId: string, account: string) => `${sourceId}\u0000${account}`;

  const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));

  const record = (sourceId: UsageLimitSourceId, login: UsageLimitSourceAccountLogin) =>
    Effect.gen(function* () {
      const accounts = logins.get(sourceId) ?? new Map<string, Tracked>();
      logins.set(sourceId, accounts);
      const previous = accounts.get(login.account);
      const endedAtMs = terminal(login.state) ? (previous?.endedAtMs ?? (yield* nowMs)) : undefined;
      accounts.set(login.account, endedAtMs === undefined ? { login } : { login, endedAtMs });
      if (previous === undefined || !Equal.equals(previous.login, login)) {
        yield* PubSub.publish(changes, sourceId);
      }
    });

  const forgetLogin = (sourceId: UsageLimitSourceId, account: string) =>
    Effect.gen(function* () {
      const running = polls.get(pollKey(sourceId, account));
      polls.delete(pollKey(sourceId, account));
      if (running) yield* Fiber.interrupt(running.fiber);
      if (logins.get(sourceId)?.delete(account)) yield* PubSub.publish(changes, sourceId);
    });

  /**
   * One call to the gateway's login API. A refusal that carries the session
   * (a code the provider refused, a login as the wrong account) is the
   * session's news, not a failure: it is returned like any other view.
   */
  const call = (
    target: ModelproxyLoginTarget,
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Effect.Effect<UsageLimitSourceAccountLogin | undefined, UsageLimitSourceError> =>
    Effect.gen(function* () {
      const token = yield* target.token;
      const url = yield* Effect.try({
        try: () => new URL(path, target.baseUrl).toString(),
        catch: () => new UsageLimitSourceError({ detail: "The gateway URL is not valid." }),
      });
      const base =
        method === "GET"
          ? HttpClientRequest.get(url)
          : method === "DELETE"
            ? HttpClientRequest.delete(url)
            : HttpClientRequest.post(url);
      const authorized = base.pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${token}`));
      const request =
        body === undefined
          ? authorized
          : yield* HttpClientRequest.bodyJson(body)(authorized).pipe(
              Effect.mapError(
                () =>
                  new UsageLimitSourceError({ detail: "The login request could not be built." }),
              ),
            );
      const response: HttpClientResponse.HttpClientResponse = yield* client.execute(request).pipe(
        Effect.timeout("90 seconds"),
        Effect.mapError(() => new UsageLimitSourceError({ detail: "The gateway did not answer." })),
      );
      if (response.status === 204) return undefined;
      const json = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
      if (response.status >= 200 && response.status < 300) {
        const view = yield* decodeView(json).pipe(
          Effect.mapError(
            () => new UsageLimitSourceError({ detail: "The gateway's login was not understood." }),
          ),
        );
        return toLogin(view);
      }
      const refusal = yield* decodeError(json).pipe(Effect.option);
      if (refusal._tag === "Some" && refusal.value.session) return toLogin(refusal.value.session);
      const message = refusal._tag === "Some" ? refusal.value.error : undefined;
      if (response.status === 404 && !message?.startsWith("unknown account")) {
        return yield* new UsageLimitSourceError({
          detail: "This gateway does not support logging accounts in yet; update it.",
        });
      }
      if (response.status === 410) {
        return yield* new UsageLimitSourceError({ detail: "The login timed out. Start again." });
      }
      return yield* new UsageLimitSourceError({
        detail: message ?? `The gateway refused the login (HTTP ${response.status}).`,
      });
    });

  const loginPath = (account: string, sessionId?: string) =>
    `/api/accounts/${encodeURIComponent(account)}/login` +
    (sessionId ? `/${encodeURIComponent(sessionId)}` : "");

  /**
   * Re-reads a device login until it finishes. A read that fails is retried
   * at the next tick: the gateway keeps the session for its whole lifetime,
   * so one dropped answer is not the end of the login.
   */
  const poll = (
    sourceId: UsageLimitSourceId,
    target: ModelproxyLoginTarget,
    login: UsageLimitSourceAccountLogin,
    owner: object,
  ) =>
    Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(POLL_EVERY);
        const read = yield* call(target, "GET", loginPath(login.account, login.sessionId)).pipe(
          Effect.result,
        );
        if (read._tag === "Failure") {
          if (read.failure.detail.startsWith("The login timed out")) {
            yield* record(sourceId, {
              ...login,
              state: "expired",
              error: "The login timed out.",
            });
            return;
          }
          continue;
        }
        if (!read.success) return;
        yield* record(sourceId, read.success);
        if (terminal(read.success.state)) return;
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const key = pollKey(sourceId, login.account);
          // Only the poll that still owns the slot clears it.
          if (polls.get(key)?.owner === owner) polls.delete(key);
        }),
      ),
    );

  const run = Effect.fn("ModelproxyAccountLogin.run")(function* (
    sourceId: UsageLimitSourceId,
    input: UsageLimitSourceAccountLoginInput,
    target: ModelproxyLoginTarget,
  ): Effect.fn.Return<UsageLimitSourceAccountLoginResult, UsageLimitSourceError> {
    const current = logins.get(sourceId)?.get(input.account)?.login;
    switch (input.action) {
      case "start": {
        const started = yield* call(target, "POST", loginPath(input.account));
        if (!started) return {};
        const key = pollKey(sourceId, input.account);
        const previous = polls.get(key);
        polls.delete(key);
        if (previous) yield* Fiber.interrupt(previous.fiber);
        yield* record(sourceId, started);
        if (started.mode === "device" && !terminal(started.state)) {
          const owner = {};
          const fiber = yield* Effect.forkIn(poll(sourceId, target, started, owner), scope);
          polls.set(key, { fiber, owner });
        }
        return { login: started };
      }
      case "submit": {
        if (!current) {
          return yield* new UsageLimitSourceError({ detail: "No login is open for that account." });
        }
        const submitted = yield* call(
          target,
          "POST",
          `${loginPath(input.account, current.sessionId)}/code`,
          { code: input.code },
        );
        if (submitted) yield* record(sourceId, submitted);
        return submitted ? { login: submitted } : {};
      }
      case "cancel": {
        if (current && !terminal(current.state)) {
          // Best effort: a session the gateway already forgot is as cancelled as it gets.
          yield* call(target, "DELETE", loginPath(input.account, current.sessionId)).pipe(
            Effect.ignore,
          );
        }
        yield* forgetLogin(sourceId, input.account);
        return {};
      }
    }
  });

  /** The logins to publish on a source's snapshot, minus ones finished a while ago. */
  const sessions = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      const now = yield* nowMs;
      const accounts = logins.get(sourceId);
      if (!accounts) return [];
      for (const [account, tracked] of accounts) {
        if (tracked.endedAtMs !== undefined && now - tracked.endedAtMs > KEEP_FINISHED_MS) {
          accounts.delete(account);
        }
      }
      return [...accounts.values()].map((tracked) => tracked.login);
    });

  /** A removed source takes its logins with it. */
  const forget = (sourceId: UsageLimitSourceId) =>
    Effect.gen(function* () {
      for (const account of logins.get(sourceId)?.keys() ?? []) {
        yield* forgetLogin(sourceId, account);
      }
      logins.delete(sourceId);
    });

  return {
    run,
    sessions,
    forget,
    get changes() {
      return Stream.fromPubSub(changes);
    },
  };
});

export type ModelproxyAccountLogin = Effect.Success<typeof makeModelproxyAccountLogin>;
