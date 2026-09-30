import type { DesktopSshEnvironmentTarget, DesktopSshOutputEntry } from "@t3tools/contracts";
import { useEffect, useState } from "react";

/** The desktop keeps this many lines per target; the view keeps no more. */
const MAX_SSH_OUTPUT_LINES = 500;
const NO_OUTPUT: ReadonlyArray<DesktopSshOutputEntry> = [];

/**
 * What bringing up a desktop-managed SSH environment printed: its recent lines, then each new
 * one while mounted. Outside the desktop app, or for a non-SSH environment, there is none.
 */
export function useSshEnvironmentOutput(
  target: DesktopSshEnvironmentTarget | null,
): ReadonlyArray<DesktopSshOutputEntry> {
  // Callers rebuild the target object on every render; its fields decide the subscription.
  const alias = target?.alias ?? null;
  const hostname = target?.hostname ?? null;
  const username = target?.username ?? null;
  const port = target?.port ?? null;
  const key = alias === null ? null : `${alias}\0${hostname}\0${username ?? ""}\0${port ?? ""}`;
  // Lines are kept with the target they came from, so switching targets never shows stale ones.
  const [output, setOutput] = useState<{
    readonly key: string | null;
    readonly entries: ReadonlyArray<DesktopSshOutputEntry>;
  }>({ key: null, entries: NO_OUTPUT });
  useEffect(() => {
    const subscribe = window.desktopBridge?.onSshEnvironmentOutput;
    if (alias === null || hostname === null || subscribe === undefined) return;
    return subscribe({ alias, hostname, username, port }, (next) =>
      setOutput((previous) => ({
        key,
        entries: [...(previous.key === key ? previous.entries : []), ...next].slice(
          -MAX_SSH_OUTPUT_LINES,
        ),
      })),
    );
  }, [key, alias, hostname, username, port]);
  return output.key === key ? output.entries : NO_OUTPUT;
}
