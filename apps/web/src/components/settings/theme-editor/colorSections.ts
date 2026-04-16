// apps/web/src/components/settings/theme-editor/colorSections.ts
import type { ColorTokens } from "@t3tools/contracts";

export interface ColorSection {
  id: string;
  title: string;
  tokens: Array<{
    key: keyof ColorTokens;
    label: string;
  }>;
}

export const COLOR_SECTIONS: ColorSection[] = [
  {
    id: "app-chrome",
    title: "App Chrome",
    tokens: [
      { key: "appChromeBackground", label: "Background" },
    ],
  },
  {
    id: "sidebar",
    title: "Sidebar",
    tokens: [
      { key: "sidebarBackground", label: "Background" },
      { key: "sidebarForeground", label: "Text" },
      { key: "sidebarBorder", label: "Border" },
      { key: "sidebarAccent", label: "Accent" },
      { key: "sidebarAccentForeground", label: "Accent Text" },
    ],
  },
  {
    id: "main-content",
    title: "Main Content",
    tokens: [
      { key: "background", label: "Background" },
      { key: "foreground", label: "Text" },
      { key: "cardBackground", label: "Card Background" },
      { key: "cardForeground", label: "Card Text" },
      { key: "popoverBackground", label: "Popover Background" },
      { key: "popoverForeground", label: "Popover Text" },
    ],
  },
  {
    id: "primary",
    title: "Primary & Accent",
    tokens: [
      { key: "primary", label: "Primary" },
      { key: "primaryForeground", label: "Primary Text" },
      { key: "ring", label: "Focus Ring" },
      { key: "secondary", label: "Secondary" },
      { key: "secondaryForeground", label: "Secondary Text" },
      { key: "muted", label: "Muted" },
      { key: "mutedForeground", label: "Muted Text" },
      { key: "accent", label: "Accent" },
      { key: "accentForeground", label: "Accent Text" },
    ],
  },
  {
    id: "code-blocks",
    title: "Code Blocks",
    tokens: [
      { key: "codeBackground", label: "Background" },
      { key: "codeBorder", label: "Border" },
    ],
  },
  {
    id: "terminal",
    title: "Terminal",
    tokens: [
      { key: "terminalBackground", label: "Background" },
      { key: "terminalForeground", label: "Text" },
      { key: "terminalCursor", label: "Cursor" },
      { key: "terminalSelectionBackground", label: "Selection" },
      { key: "terminalBlack", label: "Black" },
      { key: "terminalRed", label: "Red" },
      { key: "terminalGreen", label: "Green" },
      { key: "terminalYellow", label: "Yellow" },
      { key: "terminalBlue", label: "Blue" },
      { key: "terminalMagenta", label: "Magenta" },
      { key: "terminalCyan", label: "Cyan" },
      { key: "terminalWhite", label: "White" },
      { key: "terminalBrightBlack", label: "Bright Black" },
      { key: "terminalBrightRed", label: "Bright Red" },
      { key: "terminalBrightGreen", label: "Bright Green" },
      { key: "terminalBrightYellow", label: "Bright Yellow" },
      { key: "terminalBrightBlue", label: "Bright Blue" },
      { key: "terminalBrightMagenta", label: "Bright Magenta" },
      { key: "terminalBrightCyan", label: "Bright Cyan" },
      { key: "terminalBrightWhite", label: "Bright White" },
    ],
  },
  {
    id: "diff",
    title: "Diff Viewer",
    tokens: [
      { key: "diffAddedBackground", label: "Added Background" },
      { key: "diffRemovedBackground", label: "Removed Background" },
    ],
  },
  {
    id: "inputs",
    title: "Inputs & Composer",
    tokens: [
      { key: "inputBackground", label: "Background" },
      { key: "inputBorder", label: "Border" },
    ],
  },
  {
    id: "buttons",
    title: "Buttons & Controls",
    tokens: [
      { key: "primaryButton", label: "Primary Button" },
      { key: "primaryButtonForeground", label: "Primary Button Text" },
      { key: "secondaryButton", label: "Secondary Button" },
      { key: "destructiveButton", label: "Destructive Button" },
      { key: "destructiveButtonForeground", label: "Destructive Button Text" },
    ],
  },
  {
    id: "borders",
    title: "Borders",
    tokens: [
      { key: "border", label: "Border Color" },
      { key: "radius", label: "Border Radius" },
    ],
  },
  {
    id: "status",
    title: "Status Colors",
    tokens: [
      { key: "info", label: "Info" },
      { key: "infoForeground", label: "Info Text" },
      { key: "success", label: "Success" },
      { key: "successForeground", label: "Success Text" },
      { key: "warning", label: "Warning" },
      { key: "warningForeground", label: "Warning Text" },
      { key: "destructive", label: "Destructive" },
      { key: "destructiveForeground", label: "Destructive Text" },
    ],
  },
];
