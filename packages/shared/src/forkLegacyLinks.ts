/**
 * Fork-only. Lathe links use the lathe-citation:, lathe-thread: and lathe-context: schemes, but
 * messages, drafts and transcripts stored before the rename hold t3-* links, so readers accept
 * both and treat an old link as its Lathe form. Writers only ever produce the Lathe form.
 */
const LEGACY_LINK_SCHEME = /^t3-(citation|thread|context):/;

const legacyProtocol = (protocol: string): string => protocol.replace(/^lathe-/, "t3-");

/** An href under a pre-rename scheme, rewritten to its Lathe scheme; any other href unchanged. */
export function latheLinkHref(href: string): string {
  return href.replace(LEGACY_LINK_SCHEME, "lathe-$1:");
}

/** Regex source matching `protocol`, a lathe-* scheme, or its pre-rename form. */
export function linkProtocolPattern(protocol: string): string {
  return `(?:${protocol}|${legacyProtocol(protocol)})`;
}

/** Whether markdown `text` links to `protocol`, under its Lathe or pre-rename form. */
export function includesLinkProtocol(text: string, protocol: string): boolean {
  return text.includes(`](${protocol}`) || text.includes(`](${legacyProtocol(protocol)}`);
}

/** `protocols` plus the pre-rename form of each lathe-* scheme, for sanitizer allowlists. */
export function withLegacyLinkProtocols(protocols: ReadonlyArray<string>): Array<string> {
  return [
    ...protocols,
    ...protocols.filter((protocol) => protocol.startsWith("lathe-")).map(legacyProtocol),
  ];
}
