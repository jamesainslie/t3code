/**
 * Fork-only. Lathe's session cookies are named lathe_session*; before the
 * rename they were t3_session*. A browser signed in before the rename still
 * sends the old cookie, which is read as a legacy cookie and re-issued under
 * the Lathe name on the next session check.
 */
export function preRenameSessionCookieName(cookieName: string): string {
  return cookieName.replace(/^lathe_session/, "t3_session");
}
