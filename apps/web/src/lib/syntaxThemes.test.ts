import { SyntaxTheme } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { registerCustomTheme, resolveTheme } = vi.hoisted(() => ({
  registerCustomTheme: vi.fn(),
  resolveTheme: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({ registerCustomTheme, resolveTheme }));

import {
  SYNTAX_THEME_OPTIONS,
  SYNTAX_THEME_CODE_BACKGROUNDS,
  buildSyntaxTheme,
  resolveSyntaxThemeName,
  syntaxThemeSwatches,
} from "./syntaxThemes";

const CUSTOM_THEMES = SyntaxTheme.literals.filter((theme) => theme !== "pierre");
const APPEARANCES = ["light", "dark"] as const;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

beforeEach(() => {
  registerCustomTheme.mockClear();
});

describe("resolveSyntaxThemeName", () => {
  it("keeps Pierre's bundled themes for the default", () => {
    expect(resolveSyntaxThemeName("dark", "pierre")).toBe("pierre-dark");
    expect(resolveSyntaxThemeName("light", "pierre")).toBe("pierre-light");
    expect(registerCustomTheme).not.toHaveBeenCalled();
  });

  it("registers a custom theme once, the first time it is resolved", () => {
    expect(resolveSyntaxThemeName("dark", "graphite")).toBe("t3-graphite-dark");
    expect(resolveSyntaxThemeName("dark", "graphite")).toBe("t3-graphite-dark");
    expect(resolveSyntaxThemeName("light", "graphite")).toBe("t3-graphite-light");

    expect(registerCustomTheme.mock.calls.map(([name]) => name)).toEqual([
      "t3-graphite-dark",
      "t3-graphite-light",
    ]);
  });

  it("registers a loader that builds the theme on Pierre's workbench colors", async () => {
    resolveTheme.mockResolvedValue({ colors: { "gitDecoration.addedResourceForeground": "#0f0" } });
    resolveSyntaxThemeName("light", "ember");
    const loader = registerCustomTheme.mock.calls.find(([name]) => name === "t3-ember-light")?.[1];

    const theme = await loader();

    expect(resolveTheme).toHaveBeenCalledWith("pierre-light");
    expect(theme.name).toBe("t3-ember-light");
    expect(theme.type).toBe("light");
    expect(theme.colors["gitDecoration.addedResourceForeground"]).toBe("#0f0");
    expect(theme.colors["editor.background"]).toBe(SYNTAX_THEME_CODE_BACKGROUNDS.light);
  });
});

describe("buildSyntaxTheme", () => {
  it.each(CUSTOM_THEMES.flatMap((theme) => APPEARANCES.map((mode) => [theme, mode] as const)))(
    "keeps every %s %s token readable on the code surface",
    (theme, appearance) => {
      const built = buildSyntaxTheme(theme, appearance, {});
      const background = SYNTAX_THEME_CODE_BACKGROUNDS[appearance];
      for (const rule of built.tokenColors) {
        expect(contrast(rule.settings.foreground, background)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("colors strings and comments apart from plain text in every theme", () => {
    for (const theme of CUSTOM_THEMES) {
      for (const appearance of APPEARANCES) {
        const built = buildSyntaxTheme(theme, appearance, {});
        const colorOf = (scope: string) =>
          built.tokenColors.find((rule) => rule.scope.some((entry) => entry === scope))?.settings
            .foreground;
        const plain = built.colors["editor.foreground"];
        expect(colorOf("string"), `${theme} ${appearance}`).not.toBe(plain);
        expect(colorOf("comment"), `${theme} ${appearance}`).not.toBe(plain);
      }
    }
  });
});

describe("syntax theme catalog", () => {
  it("offers every theme the settings schema accepts, Pierre first", () => {
    expect(SYNTAX_THEME_OPTIONS.map((option) => option.id)).toEqual([...SyntaxTheme.literals]);
    expect(SYNTAX_THEME_OPTIONS[0]?.id).toBe("pierre");
  });

  it("describes each theme with a swatch strip for both appearances", () => {
    for (const { id } of SYNTAX_THEME_OPTIONS) {
      for (const appearance of APPEARANCES) {
        const swatches = syntaxThemeSwatches(id, appearance);
        expect(swatches.length).toBeGreaterThan(0);
        for (const { color } of swatches) expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});
