import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  // Fork: the desktop registers the fork schemes, so returns go there.
  it.each(["t3code-fork", "t3code-fork-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each([
    // Upstream's app, installed beside the fork, must not receive the fork's returns.
    "t3code://app/welcome",
    "t3code-fork://attacker/welcome",
    "t3code-fork://app:123/welcome",
    "t3code-fork://app/auth/callback",
    "t3code-fork://user@ app/welcome",
    "t3code-fork://app/welcome/../evil",
    "https://attacker.example/welcome",
    "file:///welcome",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
