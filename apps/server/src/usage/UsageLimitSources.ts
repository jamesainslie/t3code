/**
 * UsageLimitSources — quota from places this environment cannot run turns
 * on: a CLIProxyAPI hub pooling several subscription accounts, or a
 * modelproxy gateway read as the signed-in operator.
 *
 * Each configured `settings.usageLimitSources` entry is polled on the
 * provider health-check interval and on every settings change, then
 * published as one snapshot per source over `subscribeServerConfig`. A source
 * that fails keeps its row with `error` set so the user can see it is
 * configured but unreachable. Nothing is persisted: like provider status,
 * this is live state that re-derives on boot. The one exception is a
 * modelproxy sign-in session, which `modelproxyAuth` keeps in the secret
 * store so a restart does not ask the user to sign in again.
 *
 * @module usage/UsageLimitSources
 */
import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  UsageLimitSourceError,
  type UsageLimitSourceAccountLoginInput,
  type UsageLimitSourceAccountLoginResult,
  type UsageLimitSourceAuthInput,
  type UsageLimitSourceAuthState,
  type UsageLimitSourceConsumeResetCreditInput,
  type ModelproxyUsageLimitSourceConfig,
  type ProviderConsumeResetCreditResult,
  type ServerSettings,
  type UsageLimitSourceConfig,
  type UsageLimitSourceId,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as Settings from "../serverSettings.ts";
import { makeCliproxyApi } from "./cliproxyApi.ts";
import { makeModelproxyAccountLogin } from "./modelproxyAccountLogin.ts";
import { makeModelproxyApi, mapModelproxyStatus } from "./modelproxyApi.ts";
import { makeModelproxyAuth } from "./modelproxyAuth.ts";

export class UsageLimitSources extends Context.Service<
  UsageLimitSources,
  {
    readonly current: Effect.Effect<ReadonlyArray<UsageLimitSourceSnapshot>>;
    /** The current set followed by every change, with repeats dropped. */
    readonly streamChanges: Stream.Stream<ReadonlyArray<UsageLimitSourceSnapshot>>;
    /** Re-read every source now. Never fails; failures land on the snapshot. */
    readonly refresh: Effect.Effect<void>;
    readonly consumeResetCredit: (
      input: UsageLimitSourceConsumeResetCreditInput,
    ) => Effect.Effect<ProviderConsumeResetCreditResult, UsageLimitSourceError>;
    /** Sign a modelproxy source in or out; the snapshot follows through the stream. */
    readonly auth: (
      input: UsageLimitSourceAuthInput,
    ) => Effect.Effect<UsageLimitSourceAuthState, UsageLimitSourceError>;
    /** Fork: log a gateway's pooled account in again (modelproxyAccountLogin.ts). */
    readonly accountLogin: (
      input: UsageLimitSourceAccountLoginInput,
    ) => Effect.Effect<UsageLimitSourceAccountLoginResult, UsageLimitSourceError>;
  }
>()("t3/usage/UsageLimitSources") {}

function sourceLabel(id: string, config: UsageLimitSourceConfig): string {
  if (config.label) return config.label;
  try {
    return new URL(config.url).host;
  } catch {
    return id;
  }
}

/**
 * A gateway T3 cannot read right now still serves its routed models, and a
 * routed model that left the picker would reset every thread that selected
 * it. A failed read therefore keeps the last routes the gateway published;
 * only removing or disabling the source takes them away.
 */
function keepGatewayRoutes(
  snapshot: UsageLimitSourceSnapshot,
  previous: ReadonlyArray<UsageLimitSourceSnapshot>,
): UsageLimitSourceSnapshot {
  if (snapshot.kind !== "modelproxy" || snapshot.error === undefined || !snapshot.proxy) {
    return snapshot;
  }
  const routes = previous.find((source) => source.id === snapshot.id)?.proxy?.routes;
  return routes ? { ...snapshot, proxy: { ...snapshot.proxy, routes } } : snapshot;
}

/** One source's read, flagged when its failure may clear on its own. */
interface SourceRead {
  readonly snapshot: UsageLimitSourceSnapshot;
  readonly transient?: true;
}

/** How long a transient failure waits before its one retry. */
const RETRY_AFTER = Duration.seconds(3);

/**
 * A transient failure within two polling intervals of a good read keeps
 * that read: one missed poll, such as a laptop waking before its network
 * does, is not an outage. The kept snapshot keeps its own `checkedAt`, so it
 * never claims to be newer than it is. Past that, the failure shows.
 */
function settleRead(
  read: SourceRead,
  previous: ReadonlyArray<UsageLimitSourceSnapshot>,
  input: { readonly nowMs: number; readonly intervalMs: number },
): UsageLimitSourceSnapshot {
  const last = previous.find((source) => source.id === read.snapshot.id);
  if (
    read.transient &&
    last !== undefined &&
    last.kind === read.snapshot.kind &&
    last.error === undefined &&
    input.nowMs - Date.parse(last.checkedAt) < 2 * input.intervalMs
  ) {
    return last;
  }
  return keepGatewayRoutes(read.snapshot, previous);
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const api = yield* makeCliproxyApi;
  const modelproxy = yield* makeModelproxyApi;
  const modelproxyAuth = yield* makeModelproxyAuth;
  const accountLogins = yield* makeModelproxyAccountLogin;
  const settingsService = yield* Settings.ServerSettingsService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const stateRef = yield* Ref.make<ReadonlyArray<UsageLimitSourceSnapshot>>([]);
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<ReadonlyArray<UsageLimitSourceSnapshot>>(),
    PubSub.shutdown,
  );

  const readModelproxy = Effect.fn("UsageLimitSources.readModelproxy")(function* (
    id: UsageLimitSourceId,
    config: ModelproxyUsageLimitSourceConfig,
    base: Pick<UsageLimitSourceSnapshot, "id" | "kind" | "label" | "checkedAt">,
  ): Effect.fn.Return<SourceRead> {
    const auth = yield* modelproxyAuth.authState(id);
    if (auth.state !== "signedIn") {
      return {
        snapshot: {
          ...base,
          accounts: [],
          error: auth.state === "pending" ? "Sign-in pending." : "Not signed in.",
          proxy: { auth },
        },
      };
    }
    const readWith = (forceRefresh: boolean) =>
      modelproxyAuth
        .accessToken(id, config, { forceRefresh })
        .pipe(Effect.flatMap((token) => modelproxy.readStatus(config.url, token)));
    let status = yield* readWith(false).pipe(Effect.result);
    // The gateway can reject a token its expiry still vouches for (a revoked
    // session, a rotated signing key); a freshly issued one settles it.
    if (
      status._tag === "Failure" &&
      status.failure._tag === "ModelproxyReadError" &&
      status.failure.unauthorized
    ) {
      status = yield* readWith(true).pipe(Effect.result);
    }
    if (status._tag === "Failure") {
      const failure = status.failure;
      if (failure._tag === "ModelproxySessionError") {
        return {
          snapshot: {
            ...base,
            accounts: [],
            error: failure.detail,
            proxy: { auth: yield* modelproxyAuth.authState(id) },
          },
          ...(failure.reason === "refreshFailed" ? { transient: true as const } : {}),
        };
      }
      yield* Effect.logDebug("usage limit source read failed", { id, cause: failure });
      return {
        snapshot: { ...base, accounts: [], error: failure.detail, proxy: { auth } },
        ...(failure.transient ? { transient: true as const } : {}),
      };
    }
    const mapped = mapModelproxyStatus(status.success, {
      checkedAt: base.checkedAt,
      nowMs: DateTime.toEpochMillis(yield* DateTime.now),
    });
    const logins = yield* accountLogins.sessions(id);
    return {
      snapshot: {
        ...base,
        accounts: mapped.accounts,
        proxy: { auth, ...mapped.proxy, ...(logins.length > 0 ? { accountLogins: logins } : {}) },
      },
    };
  });

  const readSourceOnce = Effect.fn("UsageLimitSources.readSourceOnce")(function* (
    id: UsageLimitSourceId,
    config: UsageLimitSourceConfig,
  ): Effect.fn.Return<SourceRead> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const base = { id, kind: config.kind, label: sourceLabel(id, config), checkedAt } as const;
    if (config.kind === "modelproxy") return yield* readModelproxy(id, config, base);
    if (config.managementKey.length === 0) {
      return { snapshot: { ...base, accounts: [], error: "No management key configured." } };
    }
    const accounts = yield* api.readAccounts(config).pipe(Effect.result);
    if (accounts._tag === "Failure") {
      yield* Effect.logDebug("usage limit source read failed", { id, cause: accounts.failure });
      return { snapshot: { ...base, accounts: [], error: accounts.failure.detail } };
    }
    return { snapshot: { ...base, accounts: accounts.success } };
  });

  /** A read whose failure may clear on its own gets one more try after a short pause. */
  const readSource = Effect.fn("UsageLimitSources.readSource")(function* (
    id: UsageLimitSourceId,
    config: UsageLimitSourceConfig,
  ): Effect.fn.Return<SourceRead> {
    const first = yield* readSourceOnce(id, config);
    if (!first.transient) return first;
    yield* Effect.sleep(RETRY_AFTER);
    return yield* readSourceOnce(id, config);
  });

  const intervalMs = settingsService.getSettings.pipe(
    Effect.map((settings) =>
      Duration.toMillis(
        Duration.fromInputUnsafe(
          resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
        ),
      ),
    ),
    Effect.orElseSucceed(() => Duration.toMillis(DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL)),
    Effect.map((ms) => (ms <= 0 ? 60_000 : ms)),
  );

  const publish = (next: ReadonlyArray<UsageLimitSourceSnapshot>) =>
    Effect.gen(function* () {
      const changed = yield* Ref.modify(stateRef, (previous) =>
        Equal.equals(previous, next) ? [false, previous] : [true, next],
      );
      if (changed) yield* PubSub.publish(changes, next);
    });

  // One refresh at a time: a slow hub read started before a settings change
  // must not publish after the change's own refresh and resurrect a removed
  // source. Callers queue behind the in-flight run and see current settings.
  const refreshLock = yield* Semaphore.make(1);
  const refresh = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.orElseSucceed((): ServerSettings | null => null),
    );
    const entries = Object.entries(settings?.usageLimitSources ?? {}).filter(
      ([, config]) => config.enabled,
    );
    // A removed or disabled gateway takes its sign-in with it; a session
    // nobody lists must not outlive its client secret in the store.
    const listed = new Set(entries.map(([id]) => id));
    const previous = yield* Ref.get(stateRef);
    yield* Effect.forEach(
      previous.filter((source) => source.kind === "modelproxy" && !listed.has(source.id)),
      (source) => Effect.andThen(modelproxyAuth.forget(source.id), accountLogins.forget(source.id)),
    );
    const reads = yield* Effect.forEach(
      entries,
      ([id, config]) => readSource(id as UsageLimitSourceId, config),
      { concurrency: 4 },
    );
    const settle = {
      nowMs: DateTime.toEpochMillis(yield* DateTime.now),
      intervalMs: yield* intervalMs,
    };
    yield* publish(reads.map((read) => settleRead(read, previous, settle)));
  }).pipe(refreshLock.withPermits(1), Effect.ignoreCause({ log: true }));

  const auth = (input: UsageLimitSourceAuthInput) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          () => new UsageLimitSourceError({ detail: "Could not read source settings." }),
        ),
      );
      const config = settings.usageLimitSources[input.sourceId];
      if (!config?.enabled || config.kind !== "modelproxy") {
        return yield* new UsageLimitSourceError({
          detail: "The gateway source is missing or disabled.",
        });
      }
      switch (input.action) {
        case "start":
          return yield* modelproxyAuth.start(input.sourceId, config);
        case "cancel":
          return yield* modelproxyAuth.cancel(input.sourceId);
        case "signOut":
          return yield* modelproxyAuth.signOut(input.sourceId);
      }
    });

  // Every sign-in transition re-reads so the snapshot's auth state and,
  // once signed in, its accounts follow without waiting for the interval.
  yield* modelproxyAuth.changes.pipe(
    Stream.runForEach(() => refresh),
    Effect.forkScoped,
  );

  // Fork: an account login's every step re-reads the same way, so the pill
  // shows the panel's next state and, once the login lands, the account back
  // to ready.
  yield* accountLogins.changes.pipe(
    Stream.runForEach(() => refresh),
    Effect.forkScoped,
  );
  const accountLogin = (input: UsageLimitSourceAccountLoginInput) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          () => new UsageLimitSourceError({ detail: "Could not read source settings." }),
        ),
      );
      const config = settings.usageLimitSources[input.sourceId];
      if (!config?.enabled || config.kind !== "modelproxy") {
        return yield* new UsageLimitSourceError({
          detail: "The gateway source is missing or disabled.",
        });
      }
      return yield* accountLogins.run(input.sourceId, input, {
        baseUrl: config.url,
        token: modelproxyAuth
          .accessToken(input.sourceId, config, { forceRefresh: false })
          .pipe(Effect.mapError((error) => new UsageLimitSourceError({ detail: error.detail }))),
      });
    });

  // Shares the refresh lock so a stale in-flight read cannot overwrite a redemption.
  const consumeResetCredit = (input: UsageLimitSourceConsumeResetCreditInput) =>
    Effect.gen(function* () {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(
          () => new UsageLimitSourceError({ detail: "Could not read hub settings." }),
        ),
      );
      const config = settings.usageLimitSources[input.sourceId];
      if (!config?.enabled || config.kind !== "cliproxy" || !config.managementKey) {
        return yield* new UsageLimitSourceError({
          detail: "The usage limit source is missing or disabled.",
        });
      }
      const result = yield* api.consume(config, input.accountId, input.creditId);
      const { snapshot } = yield* readSource(input.sourceId, config);
      const previous = yield* Ref.get(stateRef);
      yield* publish(previous.map((source) => (source.id === input.sourceId ? snapshot : source)));
      return result;
    }).pipe(refreshLock.withPermits(1));

  // Settings edits re-read straight away so a new hub shows up without
  // waiting for the interval, and a removed one leaves the list.
  yield* settingsService.streamChanges.pipe(
    Stream.map((settings) => settings.usageLimitSources),
    Stream.changes,
    Stream.runForEach(() => refresh),
    Effect.forkScoped,
  );

  yield* Effect.forever(
    intervalMs.pipe(
      Effect.flatMap((ms) => Effect.sleep(Duration.millis(ms))),
      Effect.andThen(backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
      Effect.flatMap((shouldRun) => (shouldRun ? refresh : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  // The interval skips reads while no client is looking, so a client coming
  // back (a laptop waking, a window refocused) re-reads a source that failed
  // or went unread for a whole interval rather than waiting for the next one.
  const refreshIfStale = Effect.gen(function* () {
    const current = yield* Ref.get(stateRef);
    const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
    const ms = yield* intervalMs;
    const stale = current.some(
      (source) => source.error !== undefined || nowMs - Date.parse(source.checkedAt) >= ms,
    );
    if (stale) yield* refresh;
  });
  yield* backgroundPolicy.streamChanges.pipe(
    Stream.mapEffect(() => backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
    Stream.changes,
    Stream.filter((shouldRun) => shouldRun),
    Stream.runForEach(() => refreshIfStale),
    Effect.forkScoped,
  );

  yield* refresh.pipe(Effect.forkScoped);

  return {
    current: Ref.get(stateRef),
    consumeResetCredit,
    auth,
    accountLogin,
    refresh,
    get streamChanges() {
      return Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          const snapshot = yield* Ref.get(stateRef);
          return Stream.concat(Stream.make(snapshot), Stream.fromSubscription(subscription)).pipe(
            Stream.changes,
          );
        }),
      );
    },
  } satisfies UsageLimitSources["Service"];
});

export const layer = Layer.effect(UsageLimitSources, make);
