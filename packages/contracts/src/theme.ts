import { Effect, Schema } from "effect";

// --- Base Theme ---

export const ThemeBase = Schema.Literals(["dark", "light"] as const);
export type ThemeBase = typeof ThemeBase.Type;

// --- Color Tokens ---

const OptionalColor = Schema.optional(Schema.String);

export const ColorTokensSchema = Schema.Struct({
  // App Chrome
  appChromeBackground: OptionalColor,

  // Sidebar
  sidebarBackground: OptionalColor,
  sidebarForeground: OptionalColor,
  sidebarBorder: OptionalColor,
  sidebarAccent: OptionalColor,
  sidebarAccentForeground: OptionalColor,

  // Main Content
  background: OptionalColor,
  foreground: OptionalColor,
  cardBackground: OptionalColor,
  cardForeground: OptionalColor,
  popoverBackground: OptionalColor,
  popoverForeground: OptionalColor,

  // Primary & Ring
  primary: OptionalColor,
  primaryForeground: OptionalColor,
  ring: OptionalColor,

  // Secondary / Muted / Accent
  secondary: OptionalColor,
  secondaryForeground: OptionalColor,
  muted: OptionalColor,
  mutedForeground: OptionalColor,
  accent: OptionalColor,
  accentForeground: OptionalColor,

  // Code Blocks
  codeBackground: OptionalColor,
  codeBorder: OptionalColor,

  // Terminal (ANSI 16-color palette)
  terminalBackground: OptionalColor,
  terminalForeground: OptionalColor,
  terminalCursor: OptionalColor,
  terminalSelectionBackground: OptionalColor,
  terminalBlack: OptionalColor,
  terminalRed: OptionalColor,
  terminalGreen: OptionalColor,
  terminalYellow: OptionalColor,
  terminalBlue: OptionalColor,
  terminalMagenta: OptionalColor,
  terminalCyan: OptionalColor,
  terminalWhite: OptionalColor,
  terminalBrightBlack: OptionalColor,
  terminalBrightRed: OptionalColor,
  terminalBrightGreen: OptionalColor,
  terminalBrightYellow: OptionalColor,
  terminalBrightBlue: OptionalColor,
  terminalBrightMagenta: OptionalColor,
  terminalBrightCyan: OptionalColor,
  terminalBrightWhite: OptionalColor,

  // Diff
  diffAddedBackground: OptionalColor,
  diffRemovedBackground: OptionalColor,

  // Inputs & Controls
  inputBackground: OptionalColor,
  inputBorder: OptionalColor,

  // Buttons
  primaryButton: OptionalColor,
  primaryButtonForeground: OptionalColor,
  secondaryButton: OptionalColor,
  destructiveButton: OptionalColor,
  destructiveButtonForeground: OptionalColor,

  // Borders
  border: OptionalColor,
  radius: Schema.optional(Schema.String),

  // Semantic Status
  info: OptionalColor,
  infoForeground: OptionalColor,
  success: OptionalColor,
  successForeground: OptionalColor,
  warning: OptionalColor,
  warningForeground: OptionalColor,
  destructive: OptionalColor,
  destructiveForeground: OptionalColor,
});

export type ColorTokens = typeof ColorTokensSchema.Type;

// --- Typography Tokens ---

export const TypographyTokensSchema = Schema.Struct({
  uiFontFamily: Schema.optional(Schema.String),
  codeFontFamily: Schema.optional(Schema.String),
  terminalFontFamily: Schema.optional(Schema.String),
  uiFontSize: Schema.optional(Schema.String),
  codeFontSize: Schema.optional(Schema.String),
  terminalFontSize: Schema.optional(Schema.String),
  lineHeight: Schema.optional(Schema.String),
  customFontUrl: Schema.optional(Schema.String),
});

export type TypographyTokens = typeof TypographyTokensSchema.Type;

export const DEFAULT_TYPOGRAPHY_TOKENS: Required<TypographyTokens> = {
  uiFontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  codeFontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  terminalFontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  uiFontSize: "14px",
  codeFontSize: "13px",
  terminalFontSize: "12px",
  lineHeight: "1.5",
  customFontUrl: "",
};

// --- Transparency Tokens ---

export const TransparencyTokensSchema = Schema.Struct({
  windowOpacity: Schema.optional(Schema.Number),
  vibrancy: Schema.optional(Schema.Literals(["auto", "none"] as const)),
});

export type TransparencyTokens = typeof TransparencyTokensSchema.Type;

export const DEFAULT_TRANSPARENCY_TOKENS: Required<TransparencyTokens> = {
  windowOpacity: 1,
  vibrancy: "none",
};

// --- Icon Set Config ---

export const IconSetConfigSchema = Schema.Struct({
  fileIcons: Schema.optional(Schema.String),
  uiIcons: Schema.optional(Schema.String),
});

export type IconSetConfig = typeof IconSetConfigSchema.Type;

// --- Theme Overrides ---

export const ThemeOverridesSchema = Schema.Struct({
  colors: Schema.optional(ColorTokensSchema),
  typography: Schema.optional(TypographyTokensSchema),
  transparency: Schema.optional(TransparencyTokensSchema),
  icons: Schema.optional(IconSetConfigSchema),
});

export type ThemeOverrides = typeof ThemeOverridesSchema.Type;

// --- Theme Metadata ---

export const ThemeMetadataSchema = Schema.Struct({
  version: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  createdAt: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(new Date().toISOString())),
  ),
  updatedAt: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(new Date().toISOString())),
  ),
});

export type ThemeMetadata = typeof ThemeMetadataSchema.Type;

// --- Theme ---

export const ThemeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base: ThemeBase,
  overrides: ThemeOverridesSchema.pipe(
    Schema.withDecodingDefault(Effect.succeed({} as ThemeOverrides)),
  ),
  metadata: ThemeMetadataSchema.pipe(
    Schema.withDecodingDefault(Effect.succeed({ version: 1 } as ThemeMetadata)),
  ),
});

export type Theme = typeof ThemeSchema.Type;

// --- Resolved Color Tokens ---

export interface ResolvedColorTokens {
  readonly appChromeBackground: string;
  readonly sidebarBackground: string;
  readonly sidebarForeground: string;
  readonly sidebarBorder: string;
  readonly sidebarAccent: string;
  readonly sidebarAccentForeground: string;
  readonly background: string;
  readonly foreground: string;
  readonly cardBackground: string;
  readonly cardForeground: string;
  readonly popoverBackground: string;
  readonly popoverForeground: string;
  readonly primary: string;
  readonly primaryForeground: string;
  readonly ring: string;
  readonly secondary: string;
  readonly secondaryForeground: string;
  readonly muted: string;
  readonly mutedForeground: string;
  readonly accent: string;
  readonly accentForeground: string;
  readonly codeBackground: string;
  readonly codeBorder: string;
  readonly terminalBackground: string;
  readonly terminalForeground: string;
  readonly terminalCursor: string;
  readonly terminalSelectionBackground: string;
  readonly terminalBlack: string;
  readonly terminalRed: string;
  readonly terminalGreen: string;
  readonly terminalYellow: string;
  readonly terminalBlue: string;
  readonly terminalMagenta: string;
  readonly terminalCyan: string;
  readonly terminalWhite: string;
  readonly terminalBrightBlack: string;
  readonly terminalBrightRed: string;
  readonly terminalBrightGreen: string;
  readonly terminalBrightYellow: string;
  readonly terminalBrightBlue: string;
  readonly terminalBrightMagenta: string;
  readonly terminalBrightCyan: string;
  readonly terminalBrightWhite: string;
  readonly diffAddedBackground: string;
  readonly diffRemovedBackground: string;
  readonly inputBackground: string;
  readonly inputBorder: string;
  readonly primaryButton: string;
  readonly primaryButtonForeground: string;
  readonly secondaryButton: string;
  readonly destructiveButton: string;
  readonly destructiveButtonForeground: string;
  readonly border: string;
  readonly radius: string;
  readonly info: string;
  readonly infoForeground: string;
  readonly success: string;
  readonly successForeground: string;
  readonly warning: string;
  readonly warningForeground: string;
  readonly destructive: string;
  readonly destructiveForeground: string;
}

// --- Icon Set Manifest ---

export const IconSetType = Schema.Literals(["file-icons", "ui-icons"] as const);
export type IconSetType = typeof IconSetType.Type;

export const IconSetManifestSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  type: IconSetType,
  description: Schema.optional(Schema.String),
  previewIcons: Schema.optional(Schema.Array(Schema.String)),
});

export type IconSetManifest = typeof IconSetManifestSchema.Type;

export interface ResolvedIconSetConfig {
  readonly fileIcons: IconSetManifest;
  readonly uiIcons: IconSetManifest;
}

export const DEFAULT_ICON_SET_CONFIG: { fileIcons: string; uiIcons: string } = {
  fileIcons: "default",
  uiIcons: "default",
};

// --- Resolved Theme (all tokens filled, no optionals) ---

export interface ResolvedTheme {
  readonly id: string;
  readonly name: string;
  readonly base: ThemeBase;
  readonly colors: ResolvedColorTokens;
  readonly typography: Required<TypographyTokens>;
  readonly transparency: Required<TransparencyTokens>;
  readonly icons: ResolvedIconSetConfig;
}
