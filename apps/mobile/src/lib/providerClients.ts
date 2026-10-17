import { isProviderDriverKind } from "@lathe/contracts";
import { acpRegistryClient } from "@lathe/provider-acp-registry/client";
import { makeProviderClientRegistry } from "@lathe/provider-core/client";
import { cursorClient } from "@lathe/provider-cursor/client";
import { grokClient } from "@lathe/provider-grok/client";
import { museClient } from "@lathe/provider-muse/client";
import { openCodeClient } from "@lathe/provider-opencode/client";
import { piClient } from "@lathe/provider-pi/client";

const providerClients = makeProviderClientRegistry([
  cursorClient,
  grokClient,
  museClient,
  openCodeClient,
  piClient,
  acpRegistryClient,
]);

export function getProviderClient(driver: string | null | undefined) {
  return isProviderDriverKind(driver) ? providerClients.get(driver) : undefined;
}
