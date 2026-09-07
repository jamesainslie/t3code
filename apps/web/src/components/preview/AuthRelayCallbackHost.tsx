import { useEffect } from "react";

import { takeAuthRelayHost } from "~/browser/authRelayHosts";
import { takeAuthRelayTab } from "~/browser/authRelayTabs";
import { terminalEnvironment } from "~/state/terminal";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";

/**
 * Finishes a sign-in the desktop caught on its way to the environment's
 * loopback listener: an in-app tab's navigation, or a request to a port the
 * desktop is holding, which is the only way a `form_post` response can come
 * back. The manual paste field stays as the fallback for query responses
 * everywhere else.
 */
export function AuthRelayCallbackHost() {
  const completeBrowserLaunch = useAtomCommand(terminalEnvironment.completeBrowserLaunch, {
    reportFailure: true,
    reportDefect: false,
  });
  useEffect(() => {
    if (!previewBridge?.onAuthRelayCallback) return;
    return previewBridge.onAuthRelayCallback((event) => {
      const relay =
        event.hostId != null
          ? takeAuthRelayHost(event.hostId)
          : event.tabId != null
            ? takeAuthRelayTab(event.tabId)
            : undefined;
      if (!relay) return;
      const formBody = event.method === "POST" && event.body ? event.body : undefined;
      void completeBrowserLaunch({
        environmentId: relay.environmentId,
        input: {
          threadId: relay.threadId,
          terminalId: relay.terminalId,
          captureId: relay.captureId,
          callbackUrl: event.url,
          ...(formBody === undefined ? {} : { formBody }),
        },
      });
    });
  }, [completeBrowserLaunch]);
  return null;
}
