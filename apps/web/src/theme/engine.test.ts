import { describe, expect, it } from "vitest";
import { resolveTheme } from "./engine";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
import type { Theme } from "@t3tools/contracts";
import { DEFAULT_TYPOGRAPHY_TOKENS, DEFAULT_TRANSPARENCY_TOKENS } from "@t3tools/contracts";

const makeTheme = (partial: Partial<Theme> & Pick<Theme, "id" | "name" | "base">): Theme => ({
  overrides: {},
  metadata: { version: 1, createdAt: "", updatedAt: "" },
  ...partial,
});

describe("resolveTheme", () => {
  it("light base + no overrides → all tokens match LIGHT_DEFAULTS", () => {
    const theme = makeTheme({ id: "light-test", name: "Light Test", base: "light" });
    const resolved = resolveTheme(theme);
    expect(resolved.base).toBe("light");
    expect(resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
    expect(resolved.colors.foreground).toBe(LIGHT_DEFAULTS.foreground);
    expect(resolved.colors.primary).toBe(LIGHT_DEFAULTS.primary);
  });

  it("dark base + no overrides → all tokens match DARK_DEFAULTS", () => {
    const theme = makeTheme({ id: "dark-test", name: "Dark Test", base: "dark" });
    const resolved = resolveTheme(theme);
    expect(resolved.colors.background).toBe(DARK_DEFAULTS.background);
    expect(resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
  });

  it("dark base + color overrides → overridden tokens use custom values, non-overridden use DARK_DEFAULTS", () => {
    const theme = makeTheme({
      id: "dark-override",
      name: "Dark Override",
      base: "dark",
      overrides: {
        colors: {
          background: "#ff0000",
          primary: "#00ff00",
        },
      },
    });
    const resolved = resolveTheme(theme);
    expect(resolved.colors.background).toBe("#ff0000");
    expect(resolved.colors.primary).toBe("#00ff00");
    expect(resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
    expect(resolved.colors.border).toBe(DARK_DEFAULTS.border);
  });

  it("light base + typography override → codeFontFamily is custom, uiFontFamily contains sans-serif", () => {
    const theme = makeTheme({
      id: "typo-test",
      name: "Typography Test",
      base: "light",
      overrides: {
        typography: {
          codeFontFamily: "Fira Code, monospace",
        },
      },
    });
    const resolved = resolveTheme(theme);
    expect(resolved.typography.codeFontFamily).toBe("Fira Code, monospace");
    expect(resolved.typography.uiFontFamily).toContain("sans-serif");
  });

  it("dark base + transparency override → windowOpacity is 0.85, vibrancy is default", () => {
    const theme = makeTheme({
      id: "trans-test",
      name: "Transparency Test",
      base: "dark",
      overrides: {
        transparency: {
          windowOpacity: 0.85,
        },
      },
    });
    const resolved = resolveTheme(theme);
    expect(resolved.transparency.windowOpacity).toBe(0.85);
    expect(resolved.transparency.vibrancy).toBe(DEFAULT_TRANSPARENCY_TOKENS.vibrancy);
  });

  it("resolved theme carries id and name unchanged", () => {
    const theme = makeTheme({ id: "my-id", name: "My Theme", base: "dark" });
    const resolved = resolveTheme(theme);
    expect(resolved.id).toBe("my-id");
    expect(resolved.name).toBe("My Theme");
  });

  it("no-override theme has full default typography tokens", () => {
    const theme = makeTheme({ id: "defaults-test", name: "Defaults Test", base: "light" });
    const resolved = resolveTheme(theme);
    expect(resolved.typography.uiFontFamily).toBe(DEFAULT_TYPOGRAPHY_TOKENS.uiFontFamily);
    expect(resolved.typography.codeFontFamily).toBe(DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily);
    expect(resolved.typography.uiFontSize).toBe(DEFAULT_TYPOGRAPHY_TOKENS.uiFontSize);
    expect(resolved.typography.lineHeight).toBe(DEFAULT_TYPOGRAPHY_TOKENS.lineHeight);
  });

  it("no-override theme has full default transparency tokens", () => {
    const theme = makeTheme({ id: "trans-defaults", name: "Trans Defaults", base: "light" });
    const resolved = resolveTheme(theme);
    expect(resolved.transparency.windowOpacity).toBe(DEFAULT_TRANSPARENCY_TOKENS.windowOpacity);
    expect(resolved.transparency.vibrancy).toBe(DEFAULT_TRANSPARENCY_TOKENS.vibrancy);
  });
});
