import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { gatewayRoutedInstanceIds } from "./gatewayRoutedInstances.ts";

const claudeAgent = ProviderDriverKind.make("claudeAgent");

describe("gatewayRoutedInstanceIds", () => {
  it("names no instance until one opts in", () => {
    expect([...gatewayRoutedInstanceIds(DEFAULT_SERVER_SETTINGS)]).toEqual([]);
  });

  it("reads the default Claude instance from its legacy settings", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        claudeAgent: {
          ...DEFAULT_SERVER_SETTINGS.providers.claudeAgent,
          gatewayRoutedModels: true,
        },
      },
    };
    expect([...gatewayRoutedInstanceIds(settings)]).toEqual(["claudeAgent"]);
  });

  it("reads added Claude instances and ignores other drivers with the same key", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("claude-iris")]: {
          driver: claudeAgent,
          displayName: "Claude (iris)",
          config: { homePath: "~/.claude-iris", gatewayRoutedModels: true },
        },
        [ProviderInstanceId.make("claude-geico")]: {
          driver: claudeAgent,
          config: { homePath: "~/.claude-geico" },
        },
        [ProviderInstanceId.make("codex-iris")]: {
          driver: ProviderDriverKind.make("codex"),
          config: { gatewayRoutedModels: true },
        },
      },
    };
    expect([...gatewayRoutedInstanceIds(settings)]).toEqual(["claude-iris"]);
  });
});
