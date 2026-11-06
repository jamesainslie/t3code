/**
 * Fork-only. app.t3.codes hands off to upstream's apps, not Lathe, so every Copy surface and MCP
 * thread link writes Lathe's own reference instead of a hosted link. Hosted links still parse and
 * open in Lathe. Flip this once Lathe has a hosted app of its own (jamesainslie/t3code#71).
 */
export const LATHE_COPIES_HOSTED_THREAD_LINKS: boolean = false;
