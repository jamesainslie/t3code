import { describe, expect, it } from "vitest";
import { LIGHT_DEFAULTS } from "./defaults";
import { buildCssPropertyMap, colorTokenToCssProperty } from "./applicator";

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
