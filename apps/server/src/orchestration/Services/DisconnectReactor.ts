/**
 * DisconnectReactor - Service interface for client disconnect reactions.
 *
 * Subscribes to the WsClientTracker "all clients disconnected" signal and
 * interrupts any active turns on threads in `approval-required` mode. Threads
 * in `full-access` mode are left running unsupervised.
 *
 * @module DisconnectReactor
 */
import { Context } from "effect";
import type { Effect, Scope } from "effect";

export interface DisconnectReactorShape {
  /**
   * Start reacting to all-clients-disconnected signals.
   *
   * The returned effect must be run in a scope so the background fiber can be
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class DisconnectReactor extends Context.Service<DisconnectReactor, DisconnectReactorShape>()(
  "t3/orchestration/Services/DisconnectReactor",
) {}
