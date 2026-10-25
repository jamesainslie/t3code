import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerConfig,
  type ServerProvider,
} from "@lathe/contracts";
import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/reactivity";
import { createThreadListEnvironmentsAtom } from "./thread-list-environments";

const ID = EnvironmentId.make("one");
const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};
const config = {
  providers: [provider],
  environment: { capabilities: {}, platform: { machine: "laptop" } },
  settings: {},
} as unknown as ServerConfig;

function harness() {
  const registry = AtomRegistry.make();
  const configs = Atom.make<ReadonlyMap<EnvironmentId, ServerConfig>>(new Map([[ID, config]]));
  const list = createThreadListEnvironmentsAtom(configs);
  registry.subscribe(list, () => {});
  registry.get(list);
  return {
    registry,
    read: () => registry.get(list),
    write: (next: ServerConfig) => registry.set(configs, new Map([[ID, next]])),
  };
}

describe("thread list environment projection", () => {
  // Fork: Continue in new thread depends on the project's thread history access.
  it("republishes continuation settings when thread history access changes", () => {
    const h = harness();
    try {
      const initial = h.read();
      const projectId = ProjectId.make("project");
      const withOverride = {
        ...config,
        settings: {
          ...config.settings,
          projectSettingsOverrides: { [projectId]: { agentThreadHistoryAccess: "off" } },
        },
      } as unknown as ServerConfig;
      h.write(withOverride);
      const updated = h.read();
      expect(updated).not.toBe(initial);
      expect(updated.continuationServerByEnvironmentId.get(ID)?.settings).toBe(
        withOverride.settings,
      );
      h.write({
        ...withOverride,
        settings: { ...withOverride.settings, environmentIcon: "laptop" },
      });
      expect(h.read()).toBe(updated);
    } finally {
      h.registry.dispose();
    }
  });
});
