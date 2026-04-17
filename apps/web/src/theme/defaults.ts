import type { ResolvedColorTokens } from "@t3tools/contracts";

/**
 * Light base theme color tokens.
 * Values extracted from index.css :root {} block and ThreadTerminalDrawer.tsx light palette.
 */
export const LIGHT_DEFAULTS: ResolvedColorTokens = {
  // App Chrome
  appChromeBackground: "#ffffff",

  // Sidebar
  sidebarBackground: "#ffffff",
  sidebarForeground: "#1f2937",
  sidebarBorder: "rgba(0, 0, 0, 0.08)",
  sidebarAccent: "rgba(0, 0, 0, 0.04)",
  sidebarAccentForeground: "#1f2937",

  // Main Content
  background: "#ffffff",
  foreground: "#1f2937",
  cardBackground: "#ffffff",
  cardForeground: "#1f2937",
  popoverBackground: "#ffffff",
  popoverForeground: "#1f2937",

  // Primary & Ring
  primary: "oklch(0.488 0.217 264)",
  primaryForeground: "#ffffff",
  ring: "oklch(0.488 0.217 264)",

  // Secondary / Muted / Accent
  secondary: "rgba(0, 0, 0, 0.04)",
  secondaryForeground: "#1f2937",
  muted: "rgba(0, 0, 0, 0.04)",
  mutedForeground: "#6b7280",
  accent: "rgba(0, 0, 0, 0.04)",
  accentForeground: "#1f2937",

  // Code Blocks
  codeBackground: "rgba(0, 0, 0, 0.04)",
  codeBorder: "rgba(0, 0, 0, 0.08)",

  // Terminal (from ThreadTerminalDrawer.tsx light palette)
  terminalBackground: "#ffffff",
  terminalForeground: "rgb(28, 33, 41)",
  terminalCursor: "rgb(38, 56, 78)",
  terminalSelectionBackground: "rgba(37, 63, 99, 0.2)",
  terminalBlack: "rgb(44, 53, 66)",
  terminalRed: "rgb(191, 70, 87)",
  terminalGreen: "rgb(60, 126, 86)",
  terminalYellow: "rgb(146, 112, 35)",
  terminalBlue: "rgb(72, 102, 163)",
  terminalMagenta: "rgb(132, 86, 149)",
  terminalCyan: "rgb(53, 127, 141)",
  terminalWhite: "rgb(210, 215, 223)",
  terminalBrightBlack: "rgb(112, 123, 140)",
  terminalBrightRed: "rgb(212, 95, 112)",
  terminalBrightGreen: "rgb(85, 148, 111)",
  terminalBrightYellow: "rgb(173, 133, 45)",
  terminalBrightBlue: "rgb(91, 124, 194)",
  terminalBrightMagenta: "rgb(153, 107, 172)",
  terminalBrightCyan: "rgb(70, 149, 164)",
  terminalBrightWhite: "rgb(236, 240, 246)",

  // Diff
  diffAddedBackground: "#dcfce7",
  diffRemovedBackground: "#fee2e2",

  // Inputs & Controls
  inputBackground: "rgba(0, 0, 0, 0.04)",
  inputBorder: "rgba(0, 0, 0, 0.1)",

  // Buttons
  primaryButton: "oklch(0.488 0.217 264)",
  primaryButtonForeground: "#ffffff",
  secondaryButton: "rgba(0, 0, 0, 0.04)",
  destructiveButton: "#ef4444",
  destructiveButtonForeground: "#b91c1c",

  // Borders
  border: "rgba(0, 0, 0, 0.08)",
  radius: "0.625rem",

  // Semantic Status
  info: "#3b82f6",
  infoForeground: "#1d4ed8",
  success: "#10b981",
  successForeground: "#047857",
  warning: "#f59e0b",
  warningForeground: "#b45309",
  destructive: "#ef4444",
  destructiveForeground: "#b91c1c",
};

/**
 * Dark base theme color tokens.
 * Values extracted from index.css @variant dark {} block and ThreadTerminalDrawer.tsx dark palette.
 */
export const DARK_DEFAULTS: ResolvedColorTokens = {
  // App Chrome
  appChromeBackground: "#161616",

  // Sidebar
  sidebarBackground: "#161616",
  sidebarForeground: "#f3f4f6",
  sidebarBorder: "rgba(255, 255, 255, 0.06)",
  sidebarAccent: "rgba(255, 255, 255, 0.04)",
  sidebarAccentForeground: "#f3f4f6",

  // Main Content
  background: "#161616",
  foreground: "#f3f4f6",
  cardBackground: "#1a1a1a",
  cardForeground: "#f3f4f6",
  popoverBackground: "#1a1a1a",
  popoverForeground: "#f3f4f6",

  // Primary & Ring
  primary: "oklch(0.588 0.217 264)",
  primaryForeground: "#ffffff",
  ring: "oklch(0.588 0.217 264)",

  // Secondary / Muted / Accent
  secondary: "rgba(255, 255, 255, 0.04)",
  secondaryForeground: "#f3f4f6",
  muted: "rgba(255, 255, 255, 0.04)",
  mutedForeground: "#9ca3af",
  accent: "rgba(255, 255, 255, 0.04)",
  accentForeground: "#f3f4f6",

  // Code Blocks
  codeBackground: "rgba(255, 255, 255, 0.04)",
  codeBorder: "rgba(255, 255, 255, 0.06)",

  // Terminal (from ThreadTerminalDrawer.tsx dark palette)
  terminalBackground: "rgb(14, 18, 24)",
  terminalForeground: "rgb(237, 241, 247)",
  terminalCursor: "rgb(180, 203, 255)",
  terminalSelectionBackground: "rgba(180, 203, 255, 0.25)",
  terminalBlack: "rgb(24, 30, 38)",
  terminalRed: "rgb(255, 122, 142)",
  terminalGreen: "rgb(134, 231, 149)",
  terminalYellow: "rgb(244, 205, 114)",
  terminalBlue: "rgb(137, 190, 255)",
  terminalMagenta: "rgb(208, 176, 255)",
  terminalCyan: "rgb(124, 232, 237)",
  terminalWhite: "rgb(210, 218, 230)",
  terminalBrightBlack: "rgb(110, 120, 136)",
  terminalBrightRed: "rgb(255, 168, 180)",
  terminalBrightGreen: "rgb(176, 245, 186)",
  terminalBrightYellow: "rgb(255, 224, 149)",
  terminalBrightBlue: "rgb(174, 210, 255)",
  terminalBrightMagenta: "rgb(229, 203, 255)",
  terminalBrightCyan: "rgb(167, 244, 247)",
  terminalBrightWhite: "rgb(244, 247, 252)",

  // Diff
  diffAddedBackground: "rgba(16, 185, 129, 0.15)",
  diffRemovedBackground: "rgba(239, 68, 68, 0.15)",

  // Inputs & Controls
  inputBackground: "rgba(255, 255, 255, 0.06)",
  inputBorder: "rgba(255, 255, 255, 0.08)",

  // Buttons
  primaryButton: "oklch(0.588 0.217 264)",
  primaryButtonForeground: "#ffffff",
  secondaryButton: "rgba(255, 255, 255, 0.04)",
  destructiveButton: "#ef4444",
  destructiveButtonForeground: "#fca5a5",

  // Borders
  border: "rgba(255, 255, 255, 0.06)",
  radius: "0.625rem",

  // Semantic Status
  info: "#3b82f6",
  infoForeground: "#60a5fa",
  success: "#10b981",
  successForeground: "#34d399",
  warning: "#f59e0b",
  warningForeground: "#fbbf24",
  destructive: "#ef4444",
  destructiveForeground: "#fca5a5",
};
