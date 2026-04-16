import { describe, expect, it } from "vitest";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

const REQUIRED_KEYS: Array<keyof typeof LIGHT_DEFAULTS> = [
  "appChromeBackground",
  "sidebarBackground",
  "sidebarForeground",
  "sidebarBorder",
  "sidebarAccent",
  "sidebarAccentForeground",
  "background",
  "foreground",
  "cardBackground",
  "cardForeground",
  "popoverBackground",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "ring",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "codeBackground",
  "codeBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelectionBackground",
  "terminalBlack",
  "terminalRed",
  "terminalGreen",
  "terminalYellow",
  "terminalBlue",
  "terminalMagenta",
  "terminalCyan",
  "terminalWhite",
  "terminalBrightBlack",
  "terminalBrightRed",
  "terminalBrightGreen",
  "terminalBrightYellow",
  "terminalBrightBlue",
  "terminalBrightMagenta",
  "terminalBrightCyan",
  "terminalBrightWhite",
  "diffAddedBackground",
  "diffRemovedBackground",
  "inputBackground",
  "inputBorder",
  "primaryButton",
  "primaryButtonForeground",
  "secondaryButton",
  "destructiveButton",
  "destructiveButtonForeground",
  "border",
  "radius",
  "info",
  "infoForeground",
  "success",
  "successForeground",
  "warning",
  "warningForeground",
  "destructive",
  "destructiveForeground",
];

describe("LIGHT_DEFAULTS", () => {
  it("has all required color token keys with non-empty values", () => {
    const spotCheck: Array<keyof typeof LIGHT_DEFAULTS> = [
      "background",
      "foreground",
      "primary",
      "primaryForeground",
      "border",
      "terminalBlack",
      "terminalBrightWhite",
    ];
    for (const key of spotCheck) {
      expect(LIGHT_DEFAULTS[key], `LIGHT_DEFAULTS.${key}`).toBeTruthy();
    }
  });

  it("has every required key present with a non-empty string value", () => {
    for (const key of REQUIRED_KEYS) {
      expect(typeof LIGHT_DEFAULTS[key], `LIGHT_DEFAULTS.${key} type`).toBe("string");
      expect(LIGHT_DEFAULTS[key].length, `LIGHT_DEFAULTS.${key} length`).toBeGreaterThan(0);
    }
  });
});

describe("DARK_DEFAULTS", () => {
  it("has all required color token keys with non-empty values", () => {
    const spotCheck: Array<keyof typeof DARK_DEFAULTS> = [
      "background",
      "foreground",
      "primary",
      "primaryForeground",
      "border",
      "terminalBlack",
      "terminalBrightWhite",
    ];
    for (const key of spotCheck) {
      expect(DARK_DEFAULTS[key], `DARK_DEFAULTS.${key}`).toBeTruthy();
    }
  });

  it("has every required key present with a non-empty string value", () => {
    for (const key of REQUIRED_KEYS) {
      expect(typeof DARK_DEFAULTS[key], `DARK_DEFAULTS.${key} type`).toBe("string");
      expect(DARK_DEFAULTS[key].length, `DARK_DEFAULTS.${key} length`).toBeGreaterThan(0);
    }
  });
});

describe("LIGHT_DEFAULTS vs DARK_DEFAULTS", () => {
  it("background values differ between light and dark", () => {
    expect(LIGHT_DEFAULTS.background).not.toBe(DARK_DEFAULTS.background);
  });

  it("foreground values differ between light and dark", () => {
    expect(LIGHT_DEFAULTS.foreground).not.toBe(DARK_DEFAULTS.foreground);
  });

  it("every key in LIGHT_DEFAULTS also exists in DARK_DEFAULTS", () => {
    for (const key of Object.keys(LIGHT_DEFAULTS) as Array<keyof typeof LIGHT_DEFAULTS>) {
      expect(DARK_DEFAULTS).toHaveProperty(key);
    }
  });

  it("every key in DARK_DEFAULTS also exists in LIGHT_DEFAULTS", () => {
    for (const key of Object.keys(DARK_DEFAULTS) as Array<keyof typeof DARK_DEFAULTS>) {
      expect(LIGHT_DEFAULTS).toHaveProperty(key);
    }
  });
});
