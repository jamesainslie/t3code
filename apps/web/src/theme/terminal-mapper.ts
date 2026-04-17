import type { ResolvedColorTokens } from "@t3tools/contracts";

/**
 * xterm.js ITheme shape (subset we use).
 * Defined locally to avoid importing @xterm/xterm in non-terminal code.
 */
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * Builds an xterm.js-compatible ITheme from resolved color tokens.
 */
export function buildTerminalTheme(colors: ResolvedColorTokens): TerminalTheme {
  return {
    background: colors.terminalBackground,
    foreground: colors.terminalForeground,
    cursor: colors.terminalCursor,
    selectionBackground: colors.terminalSelectionBackground,
    black: colors.terminalBlack,
    red: colors.terminalRed,
    green: colors.terminalGreen,
    yellow: colors.terminalYellow,
    blue: colors.terminalBlue,
    magenta: colors.terminalMagenta,
    cyan: colors.terminalCyan,
    white: colors.terminalWhite,
    brightBlack: colors.terminalBrightBlack,
    brightRed: colors.terminalBrightRed,
    brightGreen: colors.terminalBrightGreen,
    brightYellow: colors.terminalBrightYellow,
    brightBlue: colors.terminalBrightBlue,
    brightMagenta: colors.terminalBrightMagenta,
    brightCyan: colors.terminalBrightCyan,
    brightWhite: colors.terminalBrightWhite,
  };
}
