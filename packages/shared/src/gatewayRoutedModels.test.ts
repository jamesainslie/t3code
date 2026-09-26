import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  UsageLimitSourceId,
  type UsageLimitSourceSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sameGatewayRoutes, withGatewayRoutedModels } from "./gatewayRoutedModels.ts";

const iris = ProviderInstanceId.make("claude-iris");
const direct = ProviderInstanceId.make("claude-geico");

function claude(instanceId: ProviderInstanceId, overrides: Partial<ServerProvider> = {}) {
  return {
    instanceId,
    driver: ProviderDriverKind.make("claudeAgent"),
    displayName: "Claude (iris)",
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-26T11:00:00.000Z",
    models: [
      {
        slug: "claude-opus-5",
        name: "Claude Opus 5",
        isCustom: false,
        capabilities: { optionDescriptors: [] },
      },
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  } satisfies ServerProvider;
}

function gateway(
  routes: NonNullable<NonNullable<UsageLimitSourceSnapshot["proxy"]>["routes"]> | undefined,
  id = "modelproxy-iris",
): UsageLimitSourceSnapshot {
  return {
    id: UsageLimitSourceId.make(id),
    kind: "modelproxy",
    label: "iris",
    checkedAt: "2026-09-26T11:00:00.000Z",
    accounts: [],
    proxy: { auth: { state: "signedIn" }, ...(routes ? { routes } : {}) },
  };
}

const kimi = { from: "kimi-k3", to: "moonshotai/kimi-k3", provider: "openrouter", kind: "model" };

describe("withGatewayRoutedModels", () => {
  it("adds routed models only to the Claude instances that opted in", () => {
    const providers = [claude(iris), claude(direct, { displayName: "Claude (GEICO)" })];
    const [routed, untouched] = withGatewayRoutedModels(
      providers,
      [gateway([kimi])],
      new Set([iris]),
    );
    expect(routed!.models.map((model) => model.slug)).toEqual(["claude-opus-5", "kimi-k3"]);
    expect(routed!.models[1]).toEqual({
      slug: "kimi-k3",
      name: "kimi-k3",
      subProvider: "OpenRouter",
      isCustom: false,
      capabilities: { optionDescriptors: [] },
    });
    expect(untouched).toBe(providers[1]);
  });

  it("never adds a route to a provider of another driver", () => {
    const codex = claude(iris, { driver: ProviderDriverKind.make("codex") });
    const [result] = withGatewayRoutedModels([codex], [gateway([kimi])], new Set([iris]));
    expect(result).toBe(codex);
  });

  it("keeps the provider's own entry when a route names a model it already offers", () => {
    const rename = { from: "claude-opus-5", to: "claude-opus-5-20260901", provider: "anthropic" };
    const [result] = withGatewayRoutedModels(
      [claude(iris)],
      [gateway([rename, kimi])],
      new Set([iris]),
    );
    expect(result!.models.map((model) => [model.slug, model.subProvider])).toEqual([
      ["claude-opus-5", undefined],
      ["kimi-k3", "OpenRouter"],
    ]);
  });

  it("labels each upstream family by its product name", () => {
    const [result] = withGatewayRoutedModels(
      [claude(iris)],
      [
        gateway([
          { from: "gpt-6", to: "gpt-6", provider: "openai" },
          { from: "claude-opus-4-8", to: "claude-opus-5", provider: "anthropic" },
          { from: "local", to: "llama", provider: "ollama" },
        ]),
      ],
      new Set([iris]),
    );
    expect(result!.models.slice(1).map((model) => model.subProvider)).toEqual([
      "OpenAI",
      "Anthropic",
      "Ollama",
    ]);
  });

  it("ignores fallback routes, whose names the picker already has", () => {
    const fallback = {
      from: "claude-fable-5",
      to: "anthropic/claude-fable-5",
      provider: "openrouter",
      kind: "fallback",
    };
    const [result] = withGatewayRoutedModels(
      [claude(iris)],
      [gateway([fallback, kimi])],
      new Set([iris]),
    );
    expect(result!.models.map((model) => model.slug)).toEqual(["claude-opus-5", "kimi-k3"]);
  });

  it("reads routes from the first gateway that publishes any", () => {
    const cliproxy: UsageLimitSourceSnapshot = {
      id: UsageLimitSourceId.make("hub"),
      kind: "cliproxy",
      label: "hub",
      checkedAt: "2026-09-26T11:00:00.000Z",
      accounts: [],
    };
    const [result] = withGatewayRoutedModels(
      [claude(iris)],
      [
        cliproxy,
        gateway(undefined, "old"),
        gateway([kimi]),
        gateway([{ from: "other", to: "x", provider: "openrouter" }], "second"),
      ],
      new Set([iris]),
    );
    expect(result!.models.map((model) => model.slug)).toEqual(["claude-opus-5", "kimi-k3"]);
  });

  it("returns the providers unchanged without routes", () => {
    const providers = [claude(iris)];
    expect(withGatewayRoutedModels(providers, [gateway(undefined)], new Set([iris]))).toEqual(
      providers,
    );
  });
});

describe("sameGatewayRoutes", () => {
  it("treats snapshots with the same published routes as equal", () => {
    const withQuota = { ...gateway([kimi]), checkedAt: "2026-09-26T12:00:00.000Z" };
    expect(sameGatewayRoutes([gateway([kimi])], [withQuota])).toBe(true);
    expect(sameGatewayRoutes([], [gateway(undefined)])).toBe(true);
  });

  it("ignores a retarget within the same upstream, which the picker does not show", () => {
    expect(
      sameGatewayRoutes([gateway([kimi])], [gateway([{ ...kimi, to: "moonshotai/kimi-k3.1" }])]),
    ).toBe(true);
  });

  it("notices a route added, moved to another upstream, or removed", () => {
    const before = [gateway([kimi])];
    expect(
      sameGatewayRoutes(before, [
        gateway([kimi, { from: "gpt-6", to: "gpt-6", provider: "openai" }]),
      ]),
    ).toBe(false);
    expect(sameGatewayRoutes(before, [gateway([{ ...kimi, provider: "openai" }])])).toBe(false);
    expect(sameGatewayRoutes(before, [gateway([])])).toBe(false);
  });
});
