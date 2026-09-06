import { useEffect } from "react";

import { takeAuthRelayTab } from "~/browser/authRelayTabs";
import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";

/**
 * Finishes a sign-in whose in-app tab the desktop intercepted on its way back
 * to the environment's loopback listener. The manual paste field stays as the
 * fallback everywhere; this only saves the copy-and-paste on desktop.
 */
export function AuthRelayCallbackHost() {
  const completeBrowserLaunch = useAtomCommand(terminalEnvironment.completeBrowserLaunch, {
    reportFailure: true,
    reportDefect: false,
  });
  useEffect(() => {
    if (!previewBridge?.onAuthRelayCallback) return;
    return previewBridge.onAuthRelayCallback((event) => {
      const tag = takeAuthRelayTab(event.tabId);
      if (!tag) return;
      void completeBrowserLaunch({
        environmentId: tag.environmentId,
        input: {
          threadId: tag.threadId,
          terminalId: tag.terminalId,
          captureId: tag.captureId,
          callbackUrl: event.url,
        },
      });
    });
  }, [completeBrowserLaunch]);
  return null;
}
