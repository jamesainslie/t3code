/**
 * Models a modelproxy gateway serves under a routed name (`kimi-k3` answered
 * by OpenRouter) and the Claude instances that should offer them. Fork-only:
 * the gateway publishes its routes on the usage-limit source snapshot, and
 * the server merges them into the provider catalog it sends clients, so a
 * route added on the gateway reaches the picker with no T3 configuration
 * beyond the per-instance opt-in.
 *
 * @module gatewayRoutedModels
 */
import type {
  ProviderInstanceId,
  ServerProvider,
  ServerProviderModel,
  UsageLimitSourceProxyRoute,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";

const CLAUDE_DRIVER = "claudeAgent";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? `${provider[0]?.toUpperCase() ?? ""}${provider.slice(1)}`;
}

/**
 * The model routes of the first modelproxy source that publishes any. A
 * fallback route only matters inside the gateway, since its name is one the
 * picker already has.
 */
function gatewayRoutes(sources: UsageLimitSourceSnapshots): UsageLimitSourceProxyRoute[] {
  for (const source of sources) {
    if (source.kind !== "modelproxy") continue;
    const routes = (source.proxy?.routes ?? []).filter(
      (route) => route.kind === undefined || route.kind === "model",
    );
    if (routes.length > 0) return routes;
  }
  return [];
}

/**
 * Appends the gateway's routed models to every opted-in Claude instance.
 * They are published as catalog models, not custom ones, because clients
 * rebuild custom rows from settings and would drop them. A route named after
 * a model the instance already lists leaves that entry alone.
 */
export function withGatewayRoutedModels(
  providers: readonly ServerProvider[],
  sources: UsageLimitSourceSnapshots,
  enabledInstanceIds: ReadonlySet<ProviderInstanceId>,
): ServerProvider[] {
  const routes = gatewayRoutes(sources);
  if (routes.length === 0 || enabledInstanceIds.size === 0) return [...providers];
  return providers.map((provider) => {
    if (provider.driver !== CLAUDE_DRIVER || !enabledInstanceIds.has(provider.instanceId)) {
      return provider;
    }
    const seen = new Set(provider.models.map((model) => model.slug));
    const routed: ServerProviderModel[] = [];
    for (const route of routes) {
      if (seen.has(route.from)) continue;
      seen.add(route.from);
      routed.push({
        slug: route.from,
        name: route.from,
        subProvider: providerLabel(route.provider),
        isCustom: false,
        capabilities: { optionDescriptors: [] },
      });
    }
    return routed.length > 0 ? { ...provider, models: [...provider.models, ...routed] } : provider;
  });
}

/**
 * Whether two source sets would add the same routed models. Quota movement
 * and a route retargeted within the same upstream change nothing a client
 * shows, so they do not count.
 */
export function sameGatewayRoutes(
  previous: UsageLimitSourceSnapshots,
  next: UsageLimitSourceSnapshots,
): boolean {
  const key = (sources: UsageLimitSourceSnapshots) =>
    gatewayRoutes(sources)
      .map((route) => `${route.from}\u0000${route.provider}`)
      .join("\u0001");
  return key(previous) === key(next);
}
