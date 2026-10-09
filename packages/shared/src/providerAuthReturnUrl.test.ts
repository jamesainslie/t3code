import { describe, expect, it } from "vite-plus/test";
import { providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  // Fork: the desktop registers the fork schemes, so returns go there.
  it.each(["lathe", "lathe-dev"])(
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
    // The pre-rename scheme is no longer registered.
    "t3code-fork://app/welcome",
    "lathe://attacker/welcome",
    "lathe://app:123/welcome",
    "lathe://app/auth/callback",
    "lathe://user@ app/welcome",
    "lathe://app/welcome/../evil",
    "https://attacker.example/welcome",
    "file:///welcome",
    "javascript:alert(1)",
  ])("rejects %s", (url) => expect(providerAuthReturnUrl(url)).toBeUndefined());
});
