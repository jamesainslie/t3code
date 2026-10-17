import {
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@lathe/contracts";
import { acpRegistryClient } from "@lathe/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@lathe/provider-core/client";
import { cursorClient } from "@lathe/provider-cursor/client";
import { grokClient } from "@lathe/provider-grok/client";
import { museClient } from "@lathe/provider-muse/client";
import { openCodeClient } from "@lathe/provider-opencode/client";
import { piClient } from "@lathe/provider-pi/client";

export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);
