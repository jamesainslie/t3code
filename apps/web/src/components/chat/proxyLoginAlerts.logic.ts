/**
 * Fork-only: which gateway accounts deserve an alert that they need a login.
 * An account that becomes flagged while the app watches is news worth a
 * desktop notification; accounts already flagged when the app first looks
 * are only mentioned, so a restart does not fire a burst of notifications
 * for something the user may already know.
 */
export interface LoginAlerts {
  /** Newly flagged: worth interrupting the user for. */
  readonly notify: readonly string[];
  /** Flagged before the app was watching: worth a quiet mention. */
  readonly mention: readonly string[];
}

/** `previous` is null on the first observation. */
export function loginAlerts(
  previous: ReadonlySet<string> | null,
  flagged: readonly string[],
): LoginAlerts {
  if (previous === null) return { notify: [], mention: [...flagged] };
  return { notify: flagged.filter((account) => !previous.has(account)), mention: [] };
}
