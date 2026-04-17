import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  ColorTokensSchema,
  TypographyTokensSchema,
  TransparencyTokensSchema,
  ThemeOverridesSchema,
  ThemeMetadataSchema,
  ThemeSchema,
  ThemeBase,
  DEFAULT_TYPOGRAPHY_TOKENS,
  DEFAULT_TRANSPARENCY_TOKENS,
  IconSetManifestSchema,
  DEFAULT_ICON_SET_CONFIG,
} from "./theme";

describe("Theme Schema", () => {
  it("decodes a minimal theme with only required fields", () => {
    const input = {
      id: "abc-123",
      name: "My Theme",
      base: "dark",
    };
    const result = Schema.decodeUnknownSync(ThemeSchema)(input);
    expect(result.id).toBe("abc-123");
    expect(result.name).toBe("My Theme");
    expect(result.base).toBe("dark");
    expect(result.overrides).toEqual({});
    expect(result.metadata.version).toBe(1);
    expect(result.metadata.createdAt).toBeDefined();
    expect(result.metadata.updatedAt).toBeDefined();
  });

  it("decodes a theme with partial color overrides", () => {
    const input = {
      id: "abc-123",
      name: "Custom",
      base: "light",
      overrides: {
        colors: {
          background: "#ff0000",
          foreground: "#00ff00",
        },
      },
    };
    const result = Schema.decodeUnknownSync(ThemeSchema)(input);
    expect(result.overrides.colors?.background).toBe("#ff0000");
    expect(result.overrides.colors?.foreground).toBe("#00ff00");
    // Other color tokens should be undefined (sparse)
    expect(result.overrides.colors?.sidebarBackground).toBeUndefined();
  });

  it("rejects invalid base values", () => {
    const input = {
      id: "abc-123",
      name: "Bad",
      base: "sepia",
    };
    expect(() => Schema.decodeUnknownSync(ThemeSchema)(input)).toThrow();
  });

  it("encodes a theme to JSON-safe object", () => {
    const input = {
      id: "abc-123",
      name: "Test",
      base: "dark" as const,
      overrides: { colors: { background: "#000" } },
      metadata: {
        version: 1,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    };
    const decoded = Schema.decodeUnknownSync(ThemeSchema)(input);
    const encoded = Schema.encodeSync(ThemeSchema)(decoded);
    expect(encoded.id).toBe("abc-123");
    expect(typeof encoded).toBe("object");
  });

  it("provides sensible typography defaults", () => {
    expect(DEFAULT_TYPOGRAPHY_TOKENS.codeFontFamily).toContain("monospace");
    expect(DEFAULT_TYPOGRAPHY_TOKENS.uiFontSize).toBe("14px");
  });

  it("provides sensible transparency defaults", () => {
    expect(DEFAULT_TRANSPARENCY_TOKENS.windowOpacity).toBe(1);
  });

  it("ThemeBase only allows light or dark", () => {
    expect(() => Schema.decodeUnknownSync(ThemeBase)("light")).not.toThrow();
    expect(() => Schema.decodeUnknownSync(ThemeBase)("dark")).not.toThrow();
    expect(() => Schema.decodeUnknownSync(ThemeBase)("system")).toThrow();
  });
});

describe("IconSetManifestSchema", () => {
  it("decodes a valid manifest with all fields", () => {
    const input = {
      id: "catppuccin-icons",
      name: "Catppuccin Icons",
      version: "1.0.0",
      type: "file-icons",
      description: "Pastel file icons",
      previewIcons: ["ts.svg", "rs.svg", "go.svg"],
    };
    const result = Schema.decodeUnknownSync(IconSetManifestSchema)(input);
    expect(result.id).toBe("catppuccin-icons");
    expect(result.name).toBe("Catppuccin Icons");
    expect(result.version).toBe("1.0.0");
    expect(result.type).toBe("file-icons");
    expect(result.description).toBe("Pastel file icons");
    expect(result.previewIcons).toEqual(["ts.svg", "rs.svg", "go.svg"]);
  });

  it("decodes a minimal manifest (only required fields)", () => {
    const input = {
      id: "default",
      name: "Default",
      version: "0.1.0",
      type: "ui-icons",
    };
    const result = Schema.decodeUnknownSync(IconSetManifestSchema)(input);
    expect(result.id).toBe("default");
    expect(result.name).toBe("Default");
    expect(result.version).toBe("0.1.0");
    expect(result.type).toBe("ui-icons");
    expect(result.description).toBeUndefined();
    expect(result.previewIcons).toBeUndefined();
  });

  it("rejects invalid type value", () => {
    const input = {
      id: "bad",
      name: "Bad",
      version: "1.0.0",
      type: "syntax-icons",
    };
    expect(() => Schema.decodeUnknownSync(IconSetManifestSchema)(input)).toThrow();
  });
});

describe("DEFAULT_ICON_SET_CONFIG", () => {
  it("has fileIcons set to 'default'", () => {
    expect(DEFAULT_ICON_SET_CONFIG.fileIcons).toBe("default");
  });

  it("has uiIcons set to 'default'", () => {
    expect(DEFAULT_ICON_SET_CONFIG.uiIcons).toBe("default");
  });
});
