/**
 * Fork-only: which gateway accounts deserve a needs-login alert. One flagged while the app
 * watches is worth a desktop notification; ones already flagged at first look are only mentioned,
 * so a restart does not fire a burst of notifications the user may already know about.
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
