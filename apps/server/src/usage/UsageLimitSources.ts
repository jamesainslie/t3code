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
import { ServerSettingsService } from "../serverSettings.ts";
import { makeCliproxyApi } from "./cliproxyApi.ts";
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

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const api = yield* makeCliproxyApi;
  const modelproxy = yield* makeModelproxyApi;
  const modelproxyAuth = yield* makeModelproxyAuth;
  const settingsService = yield* ServerSettingsService;
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
  ): Effect.fn.Return<UsageLimitSourceSnapshot> {
    const auth = yield* modelproxyAuth.authState(id);
    if (auth.state !== "signedIn") {
      return {
        ...base,
        accounts: [],
        error: auth.state === "pending" ? "Sign-in pending." : "Not signed in.",
        proxy: { auth },
      };
    }
    const token = yield* modelproxyAuth.accessToken(id, config).pipe(Effect.result);
    if (token._tag === "Failure") {
      return {
        ...base,
        accounts: [],
        error: token.failure.detail,
        proxy: { auth: yield* modelproxyAuth.authState(id) },
      };
    }
    const status = yield* modelproxy.readStatus(config.url, token.success).pipe(Effect.result);
    if (status._tag === "Failure") {
      yield* Effect.logDebug("usage limit source read failed", { id, cause: status.failure });
      return { ...base, accounts: [], error: status.failure.detail, proxy: { auth } };
    }
    const mapped = mapModelproxyStatus(status.success, {
      checkedAt: base.checkedAt,
      nowMs: DateTime.toEpochMillis(yield* DateTime.now),
    });
    return { ...base, accounts: mapped.accounts, proxy: { auth, ...mapped.proxy } };
  });

  const readSource = Effect.fn("UsageLimitSources.readSource")(function* (
    id: UsageLimitSourceId,
    config: UsageLimitSourceConfig,
  ): Effect.fn.Return<UsageLimitSourceSnapshot> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const base = { id, kind: config.kind, label: sourceLabel(id, config), checkedAt } as const;
    if (config.kind === "modelproxy") return yield* readModelproxy(id, config, base);
    if (config.managementKey.length === 0) {
      return { ...base, accounts: [], error: "No management key configured." };
    }
    const accounts = yield* api.readAccounts(config).pipe(Effect.result);
    if (accounts._tag === "Failure") {
      yield* Effect.logDebug("usage limit source read failed", { id, cause: accounts.failure });
      return { ...base, accounts: [], error: accounts.failure.detail };
    }
    return { ...base, accounts: accounts.success };
  });

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
      (source) => modelproxyAuth.forget(source.id),
    );
    const snapshots = yield* Effect.forEach(
      entries,
      ([id, config]) => readSource(id as UsageLimitSourceId, config),
      { concurrency: 4 },
    );
    yield* publish(snapshots);
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
      const snapshot = yield* readSource(input.sourceId, config);
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

  const interval = settingsService.getSettings.pipe(
    Effect.map(
      (settings) => resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
    ),
    Effect.orElseSucceed(() => DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL),
  );
  yield* Effect.forever(
    interval.pipe(
      Effect.flatMap((wait) =>
        Effect.sleep(Duration.toMillis(Duration.fromInputUnsafe(wait)) <= 0 ? "60 seconds" : wait),
      ),
      Effect.andThen(backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
      Effect.flatMap((shouldRun) => (shouldRun ? refresh : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  yield* refresh.pipe(Effect.forkScoped);

  return {
    current: Ref.get(stateRef),
    consumeResetCredit,
    auth,
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
