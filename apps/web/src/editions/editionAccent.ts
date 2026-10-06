import type { Edition } from "@t3tools/contracts";

import { getEdition } from "./editions";

/** The accent to apply: only while artwork shows and "Use edition accent" is on. */
export function resolveEditionAccent(input: {
  artworkEdition: Edition | null;
  accentEnabled: boolean;
}): string | null {
  return input.artworkEdition && input.accentEnabled
    ? getEdition(input.artworkEdition).accent
    : null;
}

/** Sets `--edition-accent` and `data-edition-accent`, which scope the CSS in `index.css`. */
export function applyEditionAccent(root: HTMLElement, accent: string | null): void {
  if (accent === null) {
    root.style.removeProperty("--edition-accent");
    delete root.dataset.editionAccent;
    return;
  }
  root.style.setProperty("--edition-accent", accent);
  root.dataset.editionAccent = "";
}
