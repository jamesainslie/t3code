import { describe, expect, it } from "vitest";
import { DEFAULT_TYPOGRAPHY_TOKENS } from "@t3tools/contracts";
import { LIGHT_DEFAULTS } from "./defaults";
import {
  buildCssPropertyMap,
  buildTypographyCssMap,
  colorTokenToCssProperty,
  typographyTokenToCssProperty,
} from "./applicator";

describe("colorTokenToCssProperty", () => {
  it('converts "background" to "--background"', () => {
    expect(colorTokenToCssProperty("background")).toBe("--background");
  });

  it('converts "appChromeBackground" to "--app-chrome-background"', () => {
    expect(colorTokenToCssProperty("appChromeBackground")).toBe("--app-chrome-background");
  });

  it('converts "sidebarAccentForeground" to "--sidebar-accent-foreground"', () => {
    expect(colorTokenToCssProperty("sidebarAccentForeground")).toBe("--sidebar-accent-foreground");
  });

  it('converts "primaryForeground" to "--primary-foreground"', () => {
    expect(colorTokenToCssProperty("primaryForeground")).toBe("--primary-foreground");
  });

  it('converts "terminalBrightRed" to "--terminal-bright-red"', () => {
    expect(colorTokenToCssProperty("terminalBrightRed")).toBe("--terminal-bright-red");
  });
});

describe("buildCssPropertyMap", () => {
  it("maps --background to LIGHT_DEFAULTS.background", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    expect(map["--background"]).toBe(LIGHT_DEFAULTS.background);
  });

  it("maps --app-chrome-background to LIGHT_DEFAULTS.appChromeBackground", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    expect(map["--app-chrome-background"]).toBe(LIGHT_DEFAULTS.appChromeBackground);
  });

  it("maps --terminal-bright-red to LIGHT_DEFAULTS.terminalBrightRed", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    expect(map["--terminal-bright-red"]).toBe(LIGHT_DEFAULTS.terminalBrightRed);
  });

  it("produces exactly as many entries as LIGHT_DEFAULTS has keys", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    expect(Object.keys(map).length).toBe(Object.keys(LIGHT_DEFAULTS).length);
  });
});

describe("typographyTokenToCssProperty", () => {
  it('converts "uiFontFamily" to "--ui-font-family"', () => {
    expect(typographyTokenToCssProperty("uiFontFamily")).toBe("--ui-font-family");
  });

  it('converts "codeFontFamily" to "--code-font-family"', () => {
    expect(typographyTokenToCssProperty("codeFontFamily")).toBe("--code-font-family");
  });

  it('converts "uiFontSize" to "--ui-font-size"', () => {
    expect(typographyTokenToCssProperty("uiFontSize")).toBe("--ui-font-size");
  });

  it('converts "codeFontSize" to "--code-font-size"', () => {
    expect(typographyTokenToCssProperty("codeFontSize")).toBe("--code-font-size");
  });

  it('converts "lineHeight" to "--line-height"', () => {
    expect(typographyTokenToCssProperty("lineHeight")).toBe("--line-height");
  });
});

describe("buildTypographyCssMap", () => {
  it("maps --ui-font-family to DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily", () => {
    const map = buildTypographyCssMap(DEFAULT_TYPOGRAPHY_TOKENS);
    expect(map["--ui-font-family"]).toBe(DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily);
  });

  it("maps --code-font-family to DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily", () => {
    const map = buildTypographyCssMap(DEFAULT_TYPOGRAPHY_TOKENS);
    expect(map["--code-font-family"]).toBe(DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily);
  });

  it("does not contain --custom-font-url key", () => {
    const map = buildTypographyCssMap(DEFAULT_TYPOGRAPHY_TOKENS);
    expect(map).not.toHaveProperty("--custom-font-url");
  });

  it("has exactly 5 entries", () => {
    const map = buildTypographyCssMap(DEFAULT_TYPOGRAPHY_TOKENS);
    expect(Object.keys(map)).toHaveLength(5);
  });
});
