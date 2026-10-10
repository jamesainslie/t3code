/**
 * Fork-only: what the Iris gateway card shows. The card opens when the pill
 * is clicked, and also whenever an account's login panel is requested (by a
 * row's login control or the "needs login" notification).
 */
import { Atom } from "effect/reactivity";

/** The account whose login panel the card shows, or null. */
export const proxyLoginPanelAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("proxy-pill:login-panel"),
);

/** Whether the card is open apart from a login panel. */
export const proxyStatusCardOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("proxy-pill:card-open"),
);
