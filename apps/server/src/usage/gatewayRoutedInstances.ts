/**
 * Which Claude instances offer a modelproxy gateway's routed models. Fork-only;
 * the merge itself lives in `@t3tools/shared/gatewayRoutedModels`.
 *
 * @module usage/gatewayRoutedInstances
 */
import type { ProviderInstanceId, ServerSettings } from "@t3tools/contracts";

import { deriveProviderInstanceConfigMap } from "../provider/ProviderInstanceRegistryHydration.ts";

/**
 * Claude instances whose `gatewayRoutedModels` switch is on, the default
 * instance included once its `providerInstances` entry sets it.
 */
export function gatewayRoutedInstanceIds(
  settings: ServerSettings,
): ReadonlySet<ProviderInstanceId> {
  const ids = new Set<ProviderInstanceId>();
  for (const [id, entry] of Object.entries(deriveProviderInstanceConfigMap(settings))) {
    const config = entry.config;
    if (
      entry.driver === "claudeAgent" &&
      typeof config === "object" &&
      config !== null &&
      "gatewayRoutedModels" in config &&
      config.gatewayRoutedModels === true
    ) {
      ids.add(id as ProviderInstanceId);
    }
  }
  return ids;
}

/** Order-insensitive equality, for dropping settings changes that do not move the set. */
export function sameInstanceIds(
  previous: ReadonlySet<ProviderInstanceId>,
  next: ReadonlySet<ProviderInstanceId>,
): boolean {
  return previous.size === next.size && [...previous].every((id) => next.has(id));
}
