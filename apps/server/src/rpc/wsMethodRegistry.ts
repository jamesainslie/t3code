// WebSocket RPC handler registry.
//
// The handler map for every WS method is split by domain into files under
// `./handlers/`. Each domain file exports a factory `(deps) => object` whose
// return type is inferred from the object literal it builds — this preserves
// the exact handler signatures so `WsRpcGroup.toLayer` can check that every
// method is covered after composition.
//
// `ws.ts` resolves all services once inside `makeWsRpcLayer`, builds a flat
// `deps` object, then composes the domain registries via `composeRegistries`
// before passing the merged map to `WsRpcGroup.toLayer`.
//
// Rationale: upstream churn frequently edits the RPC handler map. Keeping
// fork-only handlers (see `./handlers/fork.ts`) in their own file avoids
// merge collisions.
//
// The `deps` object is intentionally flat (`{ currentSessionId, ..., helpers }`)
// to keep handler bodies easy to read — a single destructure at the top of
// each factory exposes everything a handler needs.

import type { WsRpcGroup } from "@t3tools/contracts";
import type { RpcGroup } from "effect/unstable/rpc";

type WsRpcs = typeof WsRpcGroup extends RpcGroup.RpcGroup<infer R> ? R : never;

/**
 * Handler function for a given WS method. Mirrors `Rpc.ToHandlerFn` for the
 * RPC matched by `K`.
 */
export type WsMethodHandler<K extends WsRpcs["_tag"]> = RpcGroup.HandlerFrom<WsRpcs, K>;

/**
 * Partial map from WS method names to their handler functions. Useful as a
 * loose upper bound for the `composeRegistries` input — each domain factory
 * returns a narrower literal type, but any of them must be assignable here.
 */
export type WsMethodRegistry = {
  readonly [K in WsRpcs["_tag"]]?: WsMethodHandler<K>;
};

/**
 * Narrow slice of the full registry covering exactly the given method keys.
 * Domain factories annotate their return value via
 * `satisfies WsMethodSlice<"methodA" | "methodB">` so every handler gets
 * contextual typing from `WsMethodHandler<K>` without repeating it per entry.
 */
export type WsMethodSlice<K extends WsRpcs["_tag"]> = {
  readonly [P in K]: WsMethodHandler<P>;
};

/**
 * Merge a variadic tuple of partial registries into one. The return type is
 * the intersection of every input so the compiler can verify the composed
 * object covers every WS method at the call site.
 */
export function composeRegistries<const T extends ReadonlyArray<WsMethodRegistry>>(
  ...registries: T
): UnionToIntersection<T[number]> {
  return Object.assign({}, ...registries) as UnionToIntersection<T[number]>;
}

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;
