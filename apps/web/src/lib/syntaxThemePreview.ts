import type { SyntaxTheme } from "@t3tools/contracts";

import { createPreviewStore } from "./previewStore";

/**
 * Pickers wait this long on a highlighted theme before applying it, so holding
 * an arrow key does not re-highlight every visible diff on each step.
 */
export const SYNTAX_THEME_PREVIEW_DELAY_MS = 120;

const store = createPreviewStore<SyntaxTheme>(SYNTAX_THEME_PREVIEW_DELAY_MS);

/**
 * Shows `theme` on every code surface without saving it, as pickers browse.
 * Pass `null` when the picker closes or selects, to return to the saved theme.
 */
export const previewSyntaxTheme = store.preview;
export const getSyntaxThemePreview = store.get;
export const subscribeSyntaxThemePreview = store.subscribe;
