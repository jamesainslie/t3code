import type { LocalApi } from "@t3tools/contracts";

// `localApi.ts` and the runtime stores form a cycle: every store needs to
// call `ensureLocalApi()` from the `LocalApi` module, but the `LocalApi`
// module itself imports a few hoisted helpers (`getPrimaryEnvironmentConnection`,
// the test-only resets) from the runtime barrel which re-exports the stores.
//
// In Vite's browser ESM loader the cycle surfaces as a temporal-dead-zone
// SyntaxError ("does not provide an export named ...") because runtime
// stores see the barrel mid-evaluation.
//
// This bridge breaks the cycle by inverting the dependency: the stores
// import only this tiny module (which has zero deps), and `localApi.ts`
// registers the resolver during its own evaluation. Calls to
// `resolveLocalApi()` happen at runtime, long after both sides have settled.

let resolver: (() => LocalApi) | null = null;

export function registerLocalApiResolver(fn: () => LocalApi): void {
  resolver = fn;
}

export function resolveLocalApi(): LocalApi {
  if (!resolver) {
    throw new Error(
      "Local API resolver is not registered yet. The web entry point should " +
        "import `./localApi` before any store touches persistence.",
    );
  }
  return resolver();
}

export function __resetLocalApiResolverForTests(): void {
  resolver = null;
}
