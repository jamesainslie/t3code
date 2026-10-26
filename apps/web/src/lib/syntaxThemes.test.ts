import { SyntaxTheme } from "@lathe/contracts";
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
    expect(resolveSyntaxThemeName("dark", "graphite")).toBe("lathe-graphite-dark");
    expect(resolveSyntaxThemeName("dark", "graphite")).toBe("lathe-graphite-dark");
    expect(resolveSyntaxThemeName("light", "graphite")).toBe("lathe-graphite-light");

    expect(registerCustomTheme.mock.calls.map(([name]) => name)).toEqual([
      "lathe-graphite-dark",
      "lathe-graphite-light",
    ]);
  });

  it("registers a Highlights loader that builds the theme on Pierre's editor colors", async () => {
    resolveTheme.mockResolvedValue({
      zed: { name: "pierre-light", appearance: "light", style: { created: "#0f0" } },
    });
    resolveSyntaxThemeName("light", "ember");
    const call = registerCustomTheme.mock.calls.find(([name]) => name === "lathe-ember-light");

    const theme = await call?.[1]();

    expect(call?.[2]).toBe("zed");
    expect(resolveTheme).toHaveBeenCalledWith("pierre-light", "highlights");
    expect(theme.name).toBe("lathe-ember-light");
    expect(theme.appearance).toBe("light");
    expect(theme.style.created).toBe("#0f0");
    expect(theme.style["editor.background"]).toBe(SYNTAX_THEME_CODE_BACKGROUNDS.light);
  });
});

describe("buildSyntaxTheme", () => {
  it.each(CUSTOM_THEMES.flatMap((theme) => APPEARANCES.map((mode) => [theme, mode] as const)))(
    "keeps every %s %s token readable on the code surface",
    (theme, appearance) => {
      const built = buildSyntaxTheme(theme, appearance, {});
      const background = SYNTAX_THEME_CODE_BACKGROUNDS[appearance];
      for (const style of Object.values(built.style.syntax ?? {})) {
        const color = typeof style === "string" ? style : style.color!;
        expect(contrast(color, background)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("colors strings and comments apart from plain text in every theme", () => {
    for (const theme of CUSTOM_THEMES) {
      for (const appearance of APPEARANCES) {
        const built = buildSyntaxTheme(theme, appearance, {});
        const colorOf = (scope: string) => {
          const style = built.style.syntax?.[scope];
          return typeof style === "string" ? style : style?.color;
        };
        const plain = built.style["editor.foreground"];
        expect(colorOf("string"), `${theme} ${appearance}`).not.toBe(plain);
        expect(colorOf("comment"), `${theme} ${appearance}`).not.toBe(plain);
      }
    }
  });

  it.each(APPEARANCES)(
    "colors Four Kinds %s function definitions and types alike, leaving variables and tags plain",
    (appearance) => {
      const built = buildSyntaxTheme("four-kinds", appearance, {});
      const colorOf = (scope: string) => {
        const style = built.style.syntax?.[scope];
        return typeof style === "string" ? style : style?.color;
      };
      const plain = built.style["editor.foreground"];
      expect(colorOf("function.definition")).not.toBe(plain);
      expect(colorOf("type")).toBe(colorOf("function.definition"));
      expect(colorOf("variable")).toBe(plain);
      expect(colorOf("tag")).toBe(plain);
    },
  );
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
