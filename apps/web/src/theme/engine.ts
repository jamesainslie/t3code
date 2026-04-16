import type {
  Theme,
  ResolvedTheme,
  ResolvedColorTokens,
  ResolvedIconSetConfig,
  IconSetManifest,
  TypographyTokens,
  TransparencyTokens,
  ThemeBase,
} from "@t3tools/contracts";
import { DEFAULT_TYPOGRAPHY_TOKENS, DEFAULT_TRANSPARENCY_TOKENS, DEFAULT_ICON_SET_CONFIG } from "@t3tools/contracts";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

function getBaseColors(base: ThemeBase): ResolvedColorTokens {
  return base === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

function mergeColors(
  base: ResolvedColorTokens,
  overrides: Partial<Record<string, string | undefined>> | undefined,
): ResolvedColorTokens {
  if (!overrides) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key in base) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

function mergeTypography(
  overrides: Partial<TypographyTokens> | undefined,
): Required<TypographyTokens> {
  if (!overrides) return { ...DEFAULT_TYPOGRAPHY_TOKENS };
  return {
    ...DEFAULT_TYPOGRAPHY_TOKENS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined),
    ),
  } as Required<TypographyTokens>;
}

function mergeTransparency(
  overrides: Partial<TransparencyTokens> | undefined,
): Required<TransparencyTokens> {
  if (!overrides) return { ...DEFAULT_TRANSPARENCY_TOKENS };
  return {
    ...DEFAULT_TRANSPARENCY_TOKENS,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined),
    ),
  } as Required<TransparencyTokens>;
}

function makeDefaultManifest(id: string, type: "file-icons" | "ui-icons"): IconSetManifest {
  return { id, name: id, version: "0.0.0", type };
}

function resolveIcons(
  overrides: { readonly fileIcons?: string | undefined; readonly uiIcons?: string | undefined } | undefined,
): ResolvedIconSetConfig {
  const fileIconsId = overrides?.fileIcons ?? DEFAULT_ICON_SET_CONFIG.fileIcons;
  const uiIconsId = overrides?.uiIcons ?? DEFAULT_ICON_SET_CONFIG.uiIcons;
  return {
    fileIcons: makeDefaultManifest(fileIconsId, "file-icons"),
    uiIcons: makeDefaultManifest(uiIconsId, "ui-icons"),
  };
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  const baseColors = getBaseColors(theme.base);
  return {
    id: theme.id,
    name: theme.name,
    base: theme.base,
    colors: mergeColors(baseColors, theme.overrides.colors as Record<string, string | undefined>),
    typography: mergeTypography(theme.overrides.typography),
    transparency: mergeTransparency(theme.overrides.transparency),
    icons: resolveIcons(theme.overrides.icons),
  };
}
