import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { KeyRoundIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { environmentServerConfigsAtom } from "../../state/server";
import { hasDesktopNotifications } from "../../threadNotifications";
import { toastManager } from "../ui/toast";
import { loginAlerts } from "./proxyLoginAlerts.logic";
import { selectProxySource } from "./ProxyUsagePill.logic";
import { proxyLoginPanelAtom } from "./proxyLoginRequest";

/**
 * Fork-only: tells the user when a gateway account needs a login, so a dead
 * credential surfaces before a turn stalls on it. Follows the same rules as
 * thread notifications: a toast while the window has focus, a desktop
 * notification (when enabled) while it does not. Either one opens the
 * gateway pill on that account's login panel.
 */
export function ProxyLoginAlertCoordinator() {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inApp = useClientSettings((settings) => settings.inAppNotificationsEnabled);
  const openLogin = useAtomSet(proxyLoginPanelAtom);
  const previous = useRef<ReadonlySet<string> | null>(null);

  const flagged = useMemo(() => {
    const selected = selectProxySource(configs, [primaryEnvironmentId]);
    if (!selected || selected.snapshot.proxy?.auth.state !== "signedIn") return null;
    return selected.snapshot.accounts
      .filter((account) => account.proxy?.state === "reauthentication")
      .map((account) => account.id);
  }, [configs, primaryEnvironmentId]);

  // Runs on every published snapshot; loginAlerts reports only what changed,
  // so a re-publish with the same flags is no news.
  useEffect(() => {
    // An unread or signed-out gateway says nothing about its accounts.
    if (flagged === null) return;
    const { notify, mention } = loginAlerts(previous.current, flagged);
    previous.current = new Set(flagged);
    const open = (account: string) => openLogin(account);
    const focused = document.visibilityState === "visible" && document.hasFocus();

    const toast = (accounts: readonly string[], title: string) => {
      if (!inApp || accounts.length === 0) return;
      const first = accounts[0]!;
      const toastId = toastManager.add({
        type: "warning",
        title,
        description: accounts.join(", "),
        data: {
          hideCopyButton: true,
          leadingIcon: <KeyRoundIcon aria-hidden className="size-4 text-warning-foreground" />,
        },
        actionProps: {
          children: "Log in",
          onClick: () => {
            toastManager.close(toastId);
            open(first);
          },
        },
      });
    };

    toast(
      mention,
      mention.length === 1 ? "Gateway account needs a login" : "Gateway accounts need a login",
    );
    if (notify.length === 0) return;
    if (focused) {
      toast(
        notify,
        notify.length === 1 ? "Gateway account needs a login" : "Gateway accounts need a login",
      );
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    for (const account of notify) {
      try {
        const notification = new Notification("Gateway account needs a login", {
          body: account,
          tag: `proxy-login:${account}`,
          silent: true,
        });
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          open(account);
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    }
  }, [flagged, inApp, mode, openLogin]);

  return null;
}
