import {
  ProviderSetupError,
  type ProviderAuthState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ProviderAuthController } from "../provider/Services/ProviderAuthService.ts";
import { AuthRelayError } from "./AuthRelayError.ts";
import {
  CALLBACK_FORWARDING_FAILED_MESSAGE,
  forwardLoopbackCallback,
  readPastedAuthorizationCode,
  validateLoopbackCallbackUrl,
  type LoopbackCallbackForwarder,
  type PastedAuthorizationCode,
  type PendingAuthorization,
  type PendingLoopbackCallback,
} from "./loopbackCallback.ts";

export type { AuthorizationCompletion, PendingAuthorization } from "./loopbackCallback.ts";

/**
 * Driver-agnostic sign-in relay for one provider instance.
 *
 * A browser sign-in started on the environment prints a URL and waits on a
 * loopback listener that the user's browser, on another machine, can never
 * reach. The flow owns the state machine around that gap: it publishes the
 * URL to the one T3 auth session that started the flow, takes the return URL
 * back from that session, replays it against the listener on this
 * environment, and reports completion only when the driver confirms the
 * native tool finished. A driver supplies how to obtain the URL, how to
 * recognize the callback, and how to sign out.
 */

export const AUTH_RELAY_TIMEOUT_MS = 300_000;
const SIGN_OUT_TIMEOUT = "90 seconds";
const isSetupError = Schema.is(ProviderSetupError);

/** Callbacks the driver's sign-in task uses to move the flow forward. */
export interface AuthRelaySignInHandle {
  /**
   * The tool asked to open a sign-in page. The same URL may arrive more than
   * once (stdout and a browser hijack, say); a different second URL fails the
   * flow because T3 can only relay one callback.
   */
  readonly receiveAuthorizationUrl: (url: string) => Effect.Effect<void, AuthRelayError>;
  /** Device-code sign-in: no callback, the user enters `userCode` on the page. */
  readonly receiveDeviceCode: (input: {
    readonly userCode: string;
    readonly verificationUrl: string;
  }) => Effect.Effect<void>;
  /** The tool took the response and is finishing on its own; hide the URL. */
  readonly verifying: (message: string) => Effect.Effect<void>;
}

export interface AuthRelayCopy<E> {
  readonly starting: string;
  readonly waiting: string;
  readonly waitingForDeviceCode: string;
  readonly verifyingCallback: string;
  readonly succeeded: string;
  readonly expired: string;
  readonly cancelled: string;
  readonly cancelledBySignOut: string;
  readonly signedOut: string;
  readonly signOutFailed: string;
  readonly signOutTimedOut: string;
  readonly busy: string;
  readonly processBusy: string;
  /**
   * Safe text for a failed sign-in. Never quote the cause; it can carry a URL
   * or code. A `ProviderSetupError` here is the flow's own deadline or a
   * driver check that already carries safe text.
   */
  readonly describeFailure: (cause: Cause.Cause<E | ProviderSetupError>) => string;
}

export interface AuthRelayDriver<E> {
  readonly instanceId: ProviderInstanceId;
  readonly copy: AuthRelayCopy<E>;
  /** Owned sign-in request check. Rejects anything the tool did not advertise as its own. */
  readonly parseAuthorizationUrl: (
    url: string,
  ) => Effect.Effect<PendingAuthorization, AuthRelayError>;
  /**
   * Runs the native sign-in to completion inside the flow's scope. Resolves
   * only when the tool confirms it authenticated; a replayed callback that
   * returned 2xx is not that confirmation.
   */
  readonly signIn: (handle: AuthRelaySignInHandle) => Effect.Effect<void, E, Scope.Scope>;
  /** Runs the native sign-out inside the flow's scope, after sessions and owned processes stopped. */
  readonly signOut: Effect.Effect<void, E | ProviderSetupError, Scope.Scope>;
  /** Extra checks on top of the loopback rules, such as a provider-specific issuer. */
  readonly validateCallback?: (
    pending: PendingLoopbackCallback,
    callbackUrl: string,
  ) => Effect.Effect<URL, AuthRelayError>;
  /** Replaces the raw loopback GET, for tests. */
  readonly forwardCallback?: LoopbackCallbackForwarder;
  /** Hands a pasted code to the tool, for authorizations that complete with a code. */
  readonly submitCode?: (input: PastedAuthorizationCode) => Effect.Effect<void, AuthRelayError>;
  readonly isLogoutPrompt?: (text: string, hasAttachments: boolean) => boolean;
}

export interface AuthRelayFlow {
  readonly controller: ProviderAuthController;
  /**
   * Admits a provider process only while no sign-in or sign-out is running,
   * and tracks it so sign-out can stop it. Sign-out must not leave a process
   * holding the old account's credentials in memory.
   */
  readonly withProcess: <A, E, R>(
    stop: Effect.Effect<void>,
    task: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
}

interface AuthSnapshot {
  readonly ownerSessionId: string | null;
  readonly state: ProviderAuthState;
}

interface ActiveFlow {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly expiresAtMillis: number;
  state: ProviderAuthState;
  pending: PendingAuthorization | undefined;
  callbackSent: boolean;
  fiber: Fiber.Fiber<void> | undefined;
  forwarding: Fiber.Fiber<void, AuthRelayError> | undefined;
}

interface OwnedProcess {
  readonly stop: Effect.Effect<void>;
  startup: Fiber.Fiber<unknown, unknown> | undefined;
}

/** What a client other than the owner may see: progress, never the URL, code, or flow id. */
export function visibleAuthState(
  snapshot: AuthSnapshot,
  ownerSessionId: string,
): ProviderAuthState {
  if (snapshot.ownerSessionId === null || snapshot.ownerSessionId === ownerSessionId) {
    return snapshot.state;
  }
  const busy = ["starting", "waiting", "verifying"].includes(snapshot.state.phase);
  const { userCode: _userCode, ...state } = snapshot.state;
  return {
    ...state,
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    ...(busy ? { message: "Sign-in is in progress in another client." } : {}),
  };
}

export const makeAuthRelayFlow = Effect.fn("makeAuthRelayFlow")(function* <E>(
  driver: AuthRelayDriver<E>,
): Effect.fn.Return<AuthRelayFlow, never, Crypto.Crypto | Scope.Scope> {
  const crypto = yield* Crypto.Crypto;
  const instanceScope = yield* Scope.Scope;
  const copy = driver.copy;
  const lock = yield* Semaphore.make(1);
  const closed = yield* Deferred.make<void>();
  const emptyState: ProviderAuthState = {
    instanceId: driver.instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  };
  const snapshot = yield* SubscriptionRef.make<AuthSnapshot>({
    ownerSessionId: null,
    state: emptyState,
  });
  const processes = new Set<OwnedProcess>();
  let activeFlow: ActiveFlow | undefined;
  let operation: "idle" | "auth" | "logout" | "cancel" | "closed" = "idle";

  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: driver.instanceId, operation: name, detail });
  const relayError = (name: string, detail: string) =>
    new AuthRelayError({ operation: name, detail });
  const currentState = (ownerSessionId: string) =>
    SubscriptionRef.get(snapshot).pipe(
      Effect.map((value) => visibleAuthState(value, ownerSessionId)),
    );
  const publishFlow = (flow: ActiveFlow, state: ProviderAuthState) => {
    flow.state = state;
    return SubscriptionRef.set(snapshot, { ownerSessionId: flow.ownerSessionId, state });
  };
  const stopOwnedProcesses = Effect.suspend(() =>
    Effect.forEach(
      Array.from(processes),
      (owned) =>
        Effect.gen(function* () {
          if (owned.startup) {
            yield* Fiber.interrupt(owned.startup);
          }
          yield* owned.stop;
        }),
      { discard: true, concurrency: "unbounded" },
    ),
  );

  const withProcess: AuthRelayFlow["withProcess"] = (stop, task) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const owned: OwnedProcess = { stop, startup: undefined };
        const fiber = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (operation !== "idle") {
              return yield* setupError("startProcess", copy.processBusy);
            }
            processes.add(owned);
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                processes.delete(owned);
              }),
            );
            const child = yield* restore(task).pipe(Effect.forkIn(scope));
            owned.startup = child;
            return child;
          }),
        );
        // Propagate interruption after the exit wait so concurrent stop waiters stay attached.
        return yield* restore(Fiber.await(fiber)).pipe(
          Effect.flatMap((result) => result),
          Effect.ensuring(Fiber.interrupt(fiber)),
          Effect.ensuring(
            Effect.sync(() => {
              owned.startup = undefined;
            }),
          ),
        );
      }),
    );

  const finishFlow = (flow: ActiveFlow, result: Exit.Exit<void, E | ProviderSetupError>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (activeFlow !== flow) return;
        activeFlow = undefined;
        operation = "idle";
        flow.pending = undefined;
        const { userCode: _userCode, ...state } = flow.state;
        yield* publishFlow(flow, {
          ...state,
          phase: Exit.isSuccess(result) ? "succeeded" : "failed",
          authorizationUrl: null,
          expiresAt: null,
          message: Exit.isSuccess(result) ? copy.succeeded : copy.describeFailure(result.cause),
        });
      }),
    );

  const makeHandle = (flow: ActiveFlow): AuthRelaySignInHandle => ({
    receiveAuthorizationUrl: (url) =>
      driver.parseAuthorizationUrl(url).pipe(
        Effect.flatMap((authorization) =>
          lock.withPermits(1)(
            Effect.gen(function* () {
              if (activeFlow !== flow || operation !== "auth") return;
              if (flow.pending) {
                if (flow.pending.authorizationUrl === authorization.authorizationUrl) return;
                return yield* relayError(
                  "start",
                  "The provider started more than one sign-in request.",
                );
              }
              flow.pending = authorization;
              yield* publishFlow(flow, {
                ...flow.state,
                phase: "waiting",
                authorizationUrl: authorization.authorizationUrl,
                message: copy.waiting,
              });
            }),
          ),
        ),
      ),
    receiveDeviceCode: (input) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (activeFlow !== flow || operation !== "auth" || flow.pending) return;
          flow.pending = {
            authorizationUrl: input.verificationUrl,
            completion: { kind: "none" },
          };
          yield* publishFlow(flow, {
            ...flow.state,
            phase: "waiting",
            authorizationUrl: input.verificationUrl,
            userCode: input.userCode,
            message: copy.waitingForDeviceCode,
          });
        }),
      ),
    verifying: (message) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if (activeFlow !== flow) return;
          flow.pending = undefined;
          const { userCode: _userCode, ...state } = flow.state;
          yield* publishFlow(flow, {
            ...state,
            phase: "verifying",
            authorizationUrl: null,
            message,
          });
        }),
      ),
  });

  const runSignIn = (flow: ActiveFlow, stopSessions: Effect.Effect<void, ProviderSetupError>) =>
    Effect.gen(function* () {
      yield* stopSessions.pipe(Effect.ensuring(stopOwnedProcesses));
      yield* driver.signIn(makeHandle(flow));
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: AUTH_RELAY_TIMEOUT_MS,
        orElse: () => Effect.fail(setupError("start", copy.expired)),
      }),
      Effect.exit,
      Effect.flatMap((result) => finishFlow(flow, result)),
    );

  const stopFlow = (flow: ActiveFlow, phase: "cancelled" | "failed", message: string) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const detached = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow) return false;
            activeFlow = undefined;
            operation = "cancel";
            flow.pending = undefined;
            const { userCode: _userCode, ...state } = flow.state;
            yield* publishFlow(flow, {
              ...state,
              phase,
              authorizationUrl: null,
              expiresAt: null,
              message,
            });
            return true;
          }),
        );
        if (!detached) return;
        if (flow.forwarding) yield* Fiber.interrupt(flow.forwarding);
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
        yield* lock.withPermits(1)(
          Effect.sync(() => {
            if (operation === "cancel") operation = "idle";
          }),
        );
      }),
    );

  const requireFlow = (ownerSessionId: string, flowId: string, name: string) =>
    Effect.gen(function* () {
      const flow = activeFlow;
      if (!flow || flow.id !== flowId || flow.ownerSessionId !== ownerSessionId) {
        return yield* setupError(name, "This sign-in is no longer active in this client.");
      }
      const now = yield* Clock.currentTimeMillis;
      if (now >= flow.expiresAtMillis) {
        return yield* setupError(name, copy.expired);
      }
      return flow;
    });

  const validateCallback = driver.validateCallback ?? validateLoopbackCallbackUrl;
  const forwardCallback = driver.forwardCallback ?? forwardLoopbackCallback;

  const controller: ProviderAuthController = {
    start: (ownerSessionId, stopSessions = Effect.void) =>
      lock.withPermits(1)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (activeFlow?.ownerSessionId === ownerSessionId && operation === "auth") {
              return activeFlow.state;
            }
            if (operation !== "idle") {
              return yield* setupError("start", copy.busy);
            }
            const flowId = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(() => setupError("start", "Could not start sign-in. Try again.")),
            );
            const expiresAtMillis = (yield* Clock.currentTimeMillis) + AUTH_RELAY_TIMEOUT_MS;
            const state: ProviderAuthState = {
              ...emptyState,
              phase: "starting",
              flowId,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
              message: copy.starting,
            };
            const flow: ActiveFlow = {
              id: flowId,
              ownerSessionId,
              expiresAtMillis,
              state,
              pending: undefined,
              callbackSent: false,
              fiber: undefined,
              forwarding: undefined,
            };
            activeFlow = flow;
            operation = "auth";
            yield* publishFlow(flow, state);
            flow.fiber = yield* runSignIn(flow, stopSessions).pipe(
              Effect.interruptible,
              Effect.forkIn(instanceScope),
            );
            return state;
          }),
        ),
      ),
    complete: Effect.fn("AuthRelayFlow.complete")(function* (ownerSessionId, input) {
      const pending = yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const flow = yield* requireFlow(ownerSessionId, input.flowId, "complete");
          const completion = flow.pending?.completion;
          if (!completion || completion.kind === "none" || flow.callbackSent) {
            return yield* setupError(
              "complete",
              flow.callbackSent
                ? "The sign-in response was already sent. Wait for sign-in to finish."
                : completion
                  ? "This sign-in finishes on the sign-in page and does not take a return URL."
                  : "Wait for the sign-in link before you send a return URL.",
            );
          }
          const delivery =
            completion.kind === "loopback"
              ? yield* validateCallback(completion.callback, input.callbackUrl).pipe(
                  Effect.map(forwardCallback),
                  Effect.mapError((error) => setupError("complete", error.detail)),
                )
              : yield* readPastedAuthorizationCode(completion.state, input.callbackUrl).pipe(
                  Effect.map((pasted) =>
                    driver.submitCode
                      ? driver.submitCode(pasted)
                      : Effect.fail(
                          new AuthRelayError({
                            operation: "complete",
                            detail: "This sign-in cannot take a pasted code.",
                          }),
                        ),
                  ),
                  Effect.mapError((error) => setupError("complete", error.detail)),
                );
          flow.callbackSent = true;
          yield* publishFlow(flow, {
            ...flow.state,
            phase: "verifying",
            authorizationUrl: null,
            message: copy.verifyingCallback,
          });
          // The instance owns delivery and its failure handling. The RPC that
          // sent the callback may disconnect before the tool answers, and the
          // flow must still settle instead of sitting at "verifying" until
          // the deadline.
          const forwarding = yield* delivery.pipe(
            // stopFlow interrupts this fiber, so it runs from a sibling fiber.
            Effect.tapError(() =>
              stopFlow(flow, "failed", CALLBACK_FORWARDING_FAILED_MESSAGE).pipe(
                Effect.forkIn(instanceScope),
              ),
            ),
            Effect.interruptible,
            Effect.forkIn(instanceScope),
          );
          flow.forwarding = forwarding;
          return { flow, forwarding };
        }),
      );
      const forwarded = yield* Fiber.await(pending.forwarding);
      if (Exit.isFailure(forwarded)) {
        return yield* setupError("complete", CALLBACK_FORWARDING_FAILED_MESSAGE);
      }
      return pending.flow.state;
    }),
    cancel: Effect.fn("AuthRelayFlow.cancel")(function* (ownerSessionId, flowId) {
      const flow = yield* lock.withPermits(1)(requireFlow(ownerSessionId, flowId, "cancel"));
      yield* stopFlow(flow, "cancelled", copy.cancelled);
      return flow.state;
    }),
    logout: Effect.fn("AuthRelayFlow.logout")(function* (stopSessions) {
      const task = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const flow = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              if (operation !== "idle" && operation !== "auth") {
                return yield* setupError("logout", copy.busy);
              }
              operation = "logout";
              const currentFlow = activeFlow;
              activeFlow = undefined;
              if (currentFlow) {
                currentFlow.pending = undefined;
                const { userCode: _userCode, ...state } = currentFlow.state;
                yield* publishFlow(currentFlow, {
                  ...state,
                  phase: "cancelled",
                  authorizationUrl: null,
                  expiresAt: null,
                  message: copy.cancelledBySignOut,
                });
              }
              return currentFlow;
            }),
          );
          const stopRemaining = Effect.gen(function* () {
            if (flow?.forwarding) yield* Fiber.interrupt(flow.forwarding);
            if (flow?.fiber) yield* Fiber.interrupt(flow.fiber);
            yield* stopOwnedProcesses;
          });
          const result = yield* restore(
            Effect.gen(function* () {
              yield* stopSessions.pipe(Effect.ensuring(stopRemaining));
              yield* driver.signOut;
            }).pipe(
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: SIGN_OUT_TIMEOUT,
                orElse: () => Effect.fail(setupError("logout", copy.signOutTimedOut)),
              }),
            ),
          ).pipe(Effect.exit);
          yield* lock.withPermits(1)(
            Effect.gen(function* () {
              operation = "idle";
              yield* SubscriptionRef.set(snapshot, {
                ownerSessionId: null,
                state: {
                  ...emptyState,
                  phase: Exit.isSuccess(result) ? "idle" : "failed",
                  message: Exit.isSuccess(result) ? copy.signedOut : copy.signOutFailed,
                },
              });
            }),
          );
          if (Exit.isFailure(result)) {
            const failure = Cause.findErrorOption(result.cause);
            return yield* Option.isSome(failure) && isSetupError(failure.value)
              ? failure.value
              : setupError("logout", copy.signOutFailed);
          }
          return yield* currentState("");
        }),
      );
      const worker = yield* task.pipe(Effect.forkIn(instanceScope));
      return yield* Fiber.await(worker).pipe(Effect.flatMap((result) => result));
    }),
    subscribe: (ownerSessionId) =>
      SubscriptionRef.changes(snapshot).pipe(
        Stream.map((value) => visibleAuthState(value, ownerSessionId)),
        Stream.interruptWhen(Deferred.await(closed)),
      ),
    ...(driver.isLogoutPrompt ? { isLogoutPrompt: driver.isLogoutPrompt } : {}),
  };

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      operation = "closed";
      const flow = activeFlow;
      activeFlow = undefined;
      if (flow) {
        flow.pending = undefined;
        if (flow.forwarding) yield* Fiber.interrupt(flow.forwarding);
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
      }
      yield* stopOwnedProcesses;
      yield* Deferred.succeed(closed, undefined);
    }),
  );

  return { controller, withProcess };
});
