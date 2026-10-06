/**
 * Fork-only: the gateway account whose login panel the header pill shows,
 * or null. The pill's rows set it, and so does the "needs login"
 * notification; while it is set the pill stays open.
 */
import { Atom } from "effect/unstable/reactivity";

export const proxyLoginPanelAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("proxy-pill:login-panel"),
);
