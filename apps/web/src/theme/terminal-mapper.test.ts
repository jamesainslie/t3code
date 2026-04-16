import { describe, expect, it } from "vitest";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
import { buildTerminalTheme } from "./terminal-mapper";

describe("buildTerminalTheme", () => {
  describe("with DARK_DEFAULTS", () => {
    const theme = buildTerminalTheme(DARK_DEFAULTS);

    it("maps background", () => expect(theme.background).toBe(DARK_DEFAULTS.terminalBackground));
    it("maps foreground", () => expect(theme.foreground).toBe(DARK_DEFAULTS.terminalForeground));
    it("maps cursor", () => expect(theme.cursor).toBe(DARK_DEFAULTS.terminalCursor));
    it("maps selectionBackground", () =>
      expect(theme.selectionBackground).toBe(DARK_DEFAULTS.terminalSelectionBackground));
    it("maps black", () => expect(theme.black).toBe(DARK_DEFAULTS.terminalBlack));
    it("maps red", () => expect(theme.red).toBe(DARK_DEFAULTS.terminalRed));
    it("maps green", () => expect(theme.green).toBe(DARK_DEFAULTS.terminalGreen));
    it("maps yellow", () => expect(theme.yellow).toBe(DARK_DEFAULTS.terminalYellow));
    it("maps blue", () => expect(theme.blue).toBe(DARK_DEFAULTS.terminalBlue));
    it("maps magenta", () => expect(theme.magenta).toBe(DARK_DEFAULTS.terminalMagenta));
    it("maps cyan", () => expect(theme.cyan).toBe(DARK_DEFAULTS.terminalCyan));
    it("maps white", () => expect(theme.white).toBe(DARK_DEFAULTS.terminalWhite));
    it("maps brightBlack", () => expect(theme.brightBlack).toBe(DARK_DEFAULTS.terminalBrightBlack));
    it("maps brightRed", () => expect(theme.brightRed).toBe(DARK_DEFAULTS.terminalBrightRed));
    it("maps brightGreen", () => expect(theme.brightGreen).toBe(DARK_DEFAULTS.terminalBrightGreen));
    it("maps brightYellow", () =>
      expect(theme.brightYellow).toBe(DARK_DEFAULTS.terminalBrightYellow));
    it("maps brightBlue", () => expect(theme.brightBlue).toBe(DARK_DEFAULTS.terminalBrightBlue));
    it("maps brightMagenta", () =>
      expect(theme.brightMagenta).toBe(DARK_DEFAULTS.terminalBrightMagenta));
    it("maps brightCyan", () => expect(theme.brightCyan).toBe(DARK_DEFAULTS.terminalBrightCyan));
    it("maps brightWhite", () => expect(theme.brightWhite).toBe(DARK_DEFAULTS.terminalBrightWhite));
  });

  it("maps background from LIGHT_DEFAULTS", () => {
    const theme = buildTerminalTheme(LIGHT_DEFAULTS);
    expect(theme.background).toBe(LIGHT_DEFAULTS.terminalBackground);
  });

  it("applies custom token overrides", () => {
    const custom = { ...DARK_DEFAULTS, terminalRed: "#ff0000" };
    const theme = buildTerminalTheme(custom);
    expect(theme.red).toBe("#ff0000");
  });
});
