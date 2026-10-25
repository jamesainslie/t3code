import {
  DEFAULT_THREAD_HIGHLIGHT_PALETTE,
  type ThreadHighlightPalette,
} from "@lathe/contracts/settings";

export function isDefaultThreadHighlightPalette(palette: ThreadHighlightPalette): boolean {
  return palette.every(
    (entry, index) =>
      entry.label === DEFAULT_THREAD_HIGHLIGHT_PALETTE[index]?.label &&
      entry.color === DEFAULT_THREAD_HIGHLIGHT_PALETTE[index]?.color,
  );
}
