/**
 * Color overrides from Settings → Appearance → Chat colors, applied as CSS
 * custom properties on the root element. Each override also toggles a data
 * flag so `index.css` can scope the override rule and leave the theme's own
 * cascade untouched while nothing is set.
 */

import { isThemeColor } from "./themePalette";

export interface AppearanceColorOverrides {
  /** Assistant and user text inside the chat timeline. */
  readonly chatText: string;
  /** The composer's text cursor. */
  readonly composerCaret: string;
  /** Resting background of thread cards in the sidebar. */
  readonly threadCard: string;
}

const OVERRIDES: ReadonlyArray<
  readonly [key: keyof AppearanceColorOverrides, variable: string, flag: string]
> = [
  ["chatText", "--user-chat-text", "userChatText"],
  ["composerCaret", "--user-composer-caret", "userComposerCaret"],
  ["threadCard", "--user-thread-card", "userThreadCard"],
];

/** A preference is applied only when it parses as a color; anything else means "theme default". */
export function resolveColorPreference(value: string): string | null {
  const trimmed = value.trim();
  return isThemeColor(trimmed) ? trimmed : null;
}

export function applyAppearanceColorOverrides(
  root: HTMLElement,
  overrides: AppearanceColorOverrides,
): void {
  for (const [key, variable, flag] of OVERRIDES) {
    const color = resolveColorPreference(overrides[key]);
    if (color === null) {
      root.style.removeProperty(variable);
      delete root.dataset[flag];
    } else {
      root.style.setProperty(variable, color);
      root.dataset[flag] = "";
    }
  }
}
