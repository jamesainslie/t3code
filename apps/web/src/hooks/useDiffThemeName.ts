import type { ClientSettings } from "@lathe/contracts";
import { useSyncExternalStore } from "react";

import { resolveDiffThemeName } from "../lib/diffRendering";
import { getSyntaxThemePreview, subscribeSyntaxThemePreview } from "../lib/syntaxThemePreview";
import { useClientSettings } from "./useSettings";
import { useRenderedAppearance } from "./useTheme";

const selectSyntaxTheme = (settings: ClientSettings) => settings.syntaxTheme;
const getServerPreview = () => null;

/**
 * Shiki theme name for code surfaces: a theme a picker is previewing, else the
 * saved syntax theme, in the app's light or dark mode.
 */
export function useDiffThemeName() {
  const resolvedTheme = useRenderedAppearance();
  const syntaxTheme = useClientSettings(selectSyntaxTheme);
  const preview = useSyncExternalStore(
    subscribeSyntaxThemePreview,
    getSyntaxThemePreview,
    getServerPreview,
  );
  return resolveDiffThemeName(resolvedTheme, preview ?? syntaxTheme);
}
