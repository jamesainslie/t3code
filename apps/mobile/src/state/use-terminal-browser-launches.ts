import {
  nextTerminalBrowserLaunchExpiry,
  pendingTerminalBrowserLaunches,
} from "@t3tools/client-runtime/state/terminal";
import { useEffect, useMemo, useState } from "react";

/**
 * The launches of a terminal that the environment still accepts. The server
 * forgets a capture five minutes after the command printed its link, and the
 * attach stream says nothing when that happens, so the banner is dropped on
 * the same deadline instead of offering an Open button that can no longer
 * work. One timer per soonest deadline, no polling.
 */
export function usePendingTerminalBrowserLaunches<T extends { readonly expiresAt: string }>(
  launches: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const [now, setNow] = useState(() => Date.now());
  const pending = useMemo(() => pendingTerminalBrowserLaunches(launches, now), [launches, now]);
  useEffect(() => {
    const delay = nextTerminalBrowserLaunchExpiry(pending, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [pending]);
  return pending;
}
