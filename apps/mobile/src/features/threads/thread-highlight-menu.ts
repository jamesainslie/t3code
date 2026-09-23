import type { MenuAction } from "@react-native-menu/menu";
import type { ThreadHighlightPalette } from "@t3tools/contracts";

const HIGHLIGHT_ID_PREFIX = "highlight:";
const HIGHLIGHT_DEFAULT_ID = `${HIGHLIGHT_ID_PREFIX}default`;

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

/** The row menu's "Highlight" submenu: Default (clear) plus one item per
    palette entry, with the thread's current color checked. */
export function buildThreadHighlightMenuAction(input: {
  readonly palette: ThreadHighlightPalette;
  readonly currentColor: string | null;
}): MenuAction {
  const current = input.currentColor === null ? null : normalizeColor(input.currentColor);
  return {
    id: "highlight",
    title: "Highlight",
    image: "paintpalette",
    subactions: [
      { id: HIGHLIGHT_DEFAULT_ID, title: "Default", state: checkedMenuState(current === null) },
      ...input.palette.map((entry, index) => ({
        id: `${HIGHLIGHT_ID_PREFIX}${index}`,
        title: entry.label,
        state: checkedMenuState(current !== null && normalizeColor(entry.color) === current),
      })),
    ],
  };
}

/** Maps a highlight submenu event id to the color to apply (null clears), or
    null when the id is not a highlight selection. */
export function resolveThreadHighlightMenuSelection(
  id: string,
  palette: ThreadHighlightPalette,
): { readonly color: string | null } | null {
  if (id === HIGHLIGHT_DEFAULT_ID) return { color: null };
  if (!id.startsWith(HIGHLIGHT_ID_PREFIX)) return null;
  const indexText = id.slice(HIGHLIGHT_ID_PREFIX.length);
  if (!/^\d+$/.test(indexText)) return null;
  const entry = palette[Number(indexText)];
  return entry === undefined ? null : { color: entry.color };
}
