/**
 * WsClientTracker - Tracks active WebSocket client connections.
 *
 * Provides a signal (PubSub) that fires when the connected client count drops
 * to zero. Consumers can react to this signal to pause or interrupt work that
 * requires human supervision.
 *
 * @module WsClientTracker
 */
import { Effect, Layer, PubSub, Ref, ServiceMap } from "effect";

export interface WsClientTrackerShape {
  /**
   * Increment the connected client count. Call when a WebSocket connection opens.
   */
  readonly onConnect: Effect.Effect<void>;

  /**
   * Decrement the connected client count. Call when a WebSocket connection closes.
   * Publishes to `allDisconnected` when the count reaches zero.
   */
  readonly onDisconnect: Effect.Effect<void>;

  /**
   * PubSub that publishes `void` whenever the connected client count drops to
   * zero. Consumers should subscribe and react to the emitted signal.
   */
  readonly allDisconnected: PubSub.PubSub<void>;
}

export class WsClientTracker extends ServiceMap.Service<WsClientTracker, WsClientTrackerShape>()(
  "t3/WsClientTracker",
) {}

export const WsClientTrackerLive = Layer.effect(
  WsClientTracker,
  Effect.gen(function* () {
    const count = yield* Ref.make(0);
    const allDisconnected = yield* PubSub.unbounded<void>();

    const onConnect: WsClientTrackerShape["onConnect"] = Ref.update(count, (n) => n + 1);

    const onDisconnect: WsClientTrackerShape["onDisconnect"] = Ref.modify(count, (n) => {
      const next = Math.max(0, n - 1);
      return [next, next] as const;
    }).pipe(
      Effect.flatMap((next) =>
        next === 0 ? PubSub.publish(allDisconnected, undefined) : Effect.succeed(false),
      ),
      Effect.asVoid,
    );

    return {
      onConnect,
      onDisconnect,
      allDisconnected,
    } satisfies WsClientTrackerShape;
  }),
);
