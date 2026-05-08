# Theme Engine Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the theme engine core and color editor — users can create custom color themes with full per-token granularity, live preview, and JSON persistence.

**Architecture:** Sparse JSON override model inheriting from dark/light base themes. A ThemeStore manages resolution and persistence, a CSS Applicator writes custom properties to `:root`, and a new Appearance settings panel provides the visual editor. Existing consumers (syntax highlighting, terminal, diff) are wired to the resolved theme.

**Tech Stack:** TypeScript, Effect Schema (types), React 19, `useSyncExternalStore`, Tailwind CSS v4, `@base-ui/react` (UI primitives), Vitest (testing)

**Design doc:** `docs/plans/2026-04-14-theme-engine-design.md`

---

## Task 1: Theme Type Definitions

Define the core theme data model using Effect Schema in the contracts package.

**Files:**

- Create: `packages/contracts/src/theme.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/theme.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/contracts/src/theme.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/contracts vitest run src/theme.test.ts`
Expected: FAIL — module `./theme` not found

**Step 3: Write the implementation**

```typescript
// packages/contracts/src/theme.ts
import { Effect, Schema } from "effect";

// --- Base Theme ---

export const ThemeBase = Schema.Literal("dark", "light");
export type ThemeBase = typeof ThemeBase.Type;

// --- Color Tokens ---

const OptionalColor = Schema.optional(Schema.String);

export const ColorTokensSchema = Schema.Struct({
  // App Chrome
  appChromeBackground: OptionalColor,

  // Sidebar
  sidebarBackground: OptionalColor,
  sidebarForeground: OptionalColor,
  sidebarBorder: OptionalColor,
  sidebarAccent: OptionalColor,
  sidebarAccentForeground: OptionalColor,

  // Main Content
  background: OptionalColor,
  foreground: OptionalColor,
  cardBackground: OptionalColor,
  cardForeground: OptionalColor,
  popoverBackground: OptionalColor,
  popoverForeground: OptionalColor,

  // Primary & Ring
  primary: OptionalColor,
  primaryForeground: OptionalColor,
  ring: OptionalColor,

  // Secondary / Muted / Accent
  secondary: OptionalColor,
  secondaryForeground: OptionalColor,
  muted: OptionalColor,
  mutedForeground: OptionalColor,
  accent: OptionalColor,
  accentForeground: OptionalColor,

  // Code Blocks
  codeBackground: OptionalColor,
  codeBorder: OptionalColor,

  // Terminal (ANSI 16-color palette)
  terminalBackground: OptionalColor,
  terminalForeground: OptionalColor,
  terminalCursor: OptionalColor,
  terminalSelectionBackground: OptionalColor,
  terminalBlack: OptionalColor,
  terminalRed: OptionalColor,
  terminalGreen: OptionalColor,
  terminalYellow: OptionalColor,
  terminalBlue: OptionalColor,
  terminalMagenta: OptionalColor,
  terminalCyan: OptionalColor,
  terminalWhite: OptionalColor,
  terminalBrightBlack: OptionalColor,
  terminalBrightRed: OptionalColor,
  terminalBrightGreen: OptionalColor,
  terminalBrightYellow: OptionalColor,
  terminalBrightBlue: OptionalColor,
  terminalBrightMagenta: OptionalColor,
  terminalBrightCyan: OptionalColor,
  terminalBrightWhite: OptionalColor,

  // Diff
  diffAddedBackground: OptionalColor,
  diffRemovedBackground: OptionalColor,

  // Inputs & Controls
  inputBackground: OptionalColor,
  inputBorder: OptionalColor,

  // Buttons
  primaryButton: OptionalColor,
  primaryButtonForeground: OptionalColor,
  secondaryButton: OptionalColor,
  destructiveButton: OptionalColor,
  destructiveButtonForeground: OptionalColor,

  // Borders
  border: OptionalColor,
  radius: Schema.optional(Schema.String),

  // Semantic Status
  info: OptionalColor,
  infoForeground: OptionalColor,
  success: OptionalColor,
  successForeground: OptionalColor,
  warning: OptionalColor,
  warningForeground: OptionalColor,
  destructive: OptionalColor,
  destructiveForeground: OptionalColor,
});

export type ColorTokens = typeof ColorTokensSchema.Type;

// --- Typography Tokens ---

export const TypographyTokensSchema = Schema.Struct({
  uiFontFamily: Schema.optional(Schema.String),
  codeFontFamily: Schema.optional(Schema.String),
  uiFontSize: Schema.optional(Schema.String),
  codeFontSize: Schema.optional(Schema.String),
  lineHeight: Schema.optional(Schema.String),
  customFontUrl: Schema.optional(Schema.String),
});

export type TypographyTokens = typeof TypographyTokensSchema.Type;

export const DEFAULT_TYPOGRAPHY_TOKENS: Required<TypographyTokens> = {
  uiFontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  codeFontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  uiFontSize: "14px",
  codeFontSize: "13px",
  lineHeight: "1.5",
  customFontUrl: "",
};

// --- Transparency Tokens ---

export const TransparencyTokensSchema = Schema.Struct({
  windowOpacity: Schema.optional(Schema.Number),
  vibrancy: Schema.optional(Schema.Literal("auto", "none")),
});

export type TransparencyTokens = typeof TransparencyTokensSchema.Type;

export const DEFAULT_TRANSPARENCY_TOKENS: Required<TransparencyTokens> = {
  windowOpacity: 1,
  vibrancy: "none",
};

// --- Icon Set Config ---

export const IconSetConfigSchema = Schema.Struct({
  fileIcons: Schema.optional(Schema.String),
  uiIcons: Schema.optional(Schema.String),
});

export type IconSetConfig = typeof IconSetConfigSchema.Type;

// --- Theme Overrides ---

export const ThemeOverridesSchema = Schema.Struct({
  colors: Schema.optional(ColorTokensSchema),
  typography: Schema.optional(TypographyTokensSchema),
  transparency: Schema.optional(TransparencyTokensSchema),
  icons: Schema.optional(IconSetConfigSchema),
});

export type ThemeOverrides = typeof ThemeOverridesSchema.Type;

// --- Theme Metadata ---

export const ThemeMetadataSchema = Schema.Struct({
  version: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
  createdAt: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(new Date().toISOString())),
  ),
  updatedAt: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed(new Date().toISOString())),
  ),
});

export type ThemeMetadata = typeof ThemeMetadataSchema.Type;

// --- Theme ---

export const ThemeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base: ThemeBase,
  overrides: ThemeOverridesSchema.pipe(
    Schema.withDecodingDefault(Effect.succeed({} as ThemeOverrides)),
  ),
  metadata: ThemeMetadataSchema.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({ version: 1 } as ThemeMetadata),
    ),
  ),
});

export type Theme = typeof ThemeSchema.Type;

// --- Resolved Theme (all tokens filled, no optionals) ---

export interface ResolvedColorTokens {
  readonly [K in keyof ColorTokens]-?: string;
}

export interface ResolvedTheme {
  readonly id: string;
  readonly name: string;
  readonly base: ThemeBase;
  readonly colors: ResolvedColorTokens;
  readonly typography: Required<TypographyTokens>;
  readonly transparency: Required<TransparencyTokens>;
}
```

**Step 4: Export from package index**

Add to `packages/contracts/src/index.ts`:

```typescript
export * from "./theme";
```

**Step 5: Run test to verify it passes**

Run: `bun run --cwd packages/contracts vitest run src/theme.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/contracts/src/theme.ts packages/contracts/src/theme.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add theme engine type definitions"
```

---

## Task 2: Base Theme Defaults

Extract the current hardcoded CSS values from `index.css` into TypeScript default token maps for dark and light base themes.

**Files:**

- Create: `apps/web/src/theme/defaults.ts`
- Test: `apps/web/src/theme/defaults.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/theme/defaults.test.ts
import { describe, expect, it } from "vitest";
import { LIGHT_DEFAULTS, DARK_DEFAULTS } from "./defaults";
import type { ResolvedColorTokens } from "@t3tools/contracts";

describe("Base Theme Defaults", () => {
  it("LIGHT_DEFAULTS has all color token keys", () => {
    const keys: Array<keyof ResolvedColorTokens> = [
      "background",
      "foreground",
      "primary",
      "primaryForeground",
      "border",
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
    ];
    for (const key of keys) {
      expect(LIGHT_DEFAULTS[key], `Missing LIGHT_DEFAULTS.${key}`).toBeDefined();
      expect(typeof LIGHT_DEFAULTS[key]).toBe("string");
    }
  });

  it("DARK_DEFAULTS has all color token keys", () => {
    const keys: Array<keyof ResolvedColorTokens> = [
      "background",
      "foreground",
      "primary",
      "primaryForeground",
      "border",
      "terminalBackground",
      "terminalForeground",
      "terminalCursor",
    ];
    for (const key of keys) {
      expect(DARK_DEFAULTS[key], `Missing DARK_DEFAULTS.${key}`).toBeDefined();
      expect(typeof DARK_DEFAULTS[key]).toBe("string");
    }
  });

  it("light and dark have different background values", () => {
    expect(LIGHT_DEFAULTS.background).not.toBe(DARK_DEFAULTS.background);
  });

  it("light and dark have different foreground values", () => {
    expect(LIGHT_DEFAULTS.foreground).not.toBe(DARK_DEFAULTS.foreground);
  });

  it("every key in LIGHT_DEFAULTS also exists in DARK_DEFAULTS", () => {
    for (const key of Object.keys(LIGHT_DEFAULTS)) {
      expect(DARK_DEFAULTS).toHaveProperty(key);
    }
  });

  it("every key in DARK_DEFAULTS also exists in LIGHT_DEFAULTS", () => {
    for (const key of Object.keys(DARK_DEFAULTS)) {
      expect(LIGHT_DEFAULTS).toHaveProperty(key);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/web/src/theme/defaults.test.ts`
Expected: FAIL — module `./defaults` not found

**Step 3: Write the implementation**

Extract values from `apps/web/src/index.css` `:root` and `@variant dark` blocks, plus terminal palette from `ThreadTerminalDrawer.tsx`.

```typescript
// apps/web/src/theme/defaults.ts
import type { ResolvedColorTokens } from "@t3tools/contracts";

/**
 * Light base theme color tokens.
 * Values extracted from index.css :root {} block and ThreadTerminalDrawer.tsx light palette.
 */
export const LIGHT_DEFAULTS: ResolvedColorTokens = {
  // App Chrome
  appChromeBackground: "#ffffff",

  // Sidebar
  sidebarBackground: "#ffffff",
  sidebarForeground: "#1f2937",
  sidebarBorder: "rgba(0, 0, 0, 0.08)",
  sidebarAccent: "rgba(0, 0, 0, 0.04)",
  sidebarAccentForeground: "#1f2937",

  // Main Content
  background: "#ffffff",
  foreground: "#1f2937",
  cardBackground: "#ffffff",
  cardForeground: "#1f2937",
  popoverBackground: "#ffffff",
  popoverForeground: "#1f2937",

  // Primary & Ring
  primary: "oklch(0.488 0.217 264)",
  primaryForeground: "#ffffff",
  ring: "oklch(0.488 0.217 264)",

  // Secondary / Muted / Accent
  secondary: "rgba(0, 0, 0, 0.04)",
  secondaryForeground: "#000000",
  muted: "rgba(0, 0, 0, 0.04)",
  mutedForeground: "#6b7280",
  accent: "rgba(0, 0, 0, 0.04)",
  accentForeground: "#1f2937",

  // Code Blocks
  codeBackground: "#f3f4f6",
  codeBorder: "rgba(0, 0, 0, 0.08)",

  // Terminal (from ThreadTerminalDrawer.tsx light palette)
  terminalBackground: "#ffffff",
  terminalForeground: "#1c2129",
  terminalCursor: "rgb(38, 56, 78)",
  terminalSelectionBackground: "rgba(38, 56, 78, 0.15)",
  terminalBlack: "rgb(44, 53, 66)",
  terminalRed: "rgb(191, 70, 87)",
  terminalGreen: "rgb(60, 126, 86)",
  terminalYellow: "rgb(168, 124, 21)",
  terminalBlue: "rgb(53, 114, 191)",
  terminalMagenta: "rgb(132, 82, 173)",
  terminalCyan: "rgb(34, 133, 140)",
  terminalWhite: "rgb(96, 108, 125)",
  terminalBrightBlack: "rgb(138, 150, 168)",
  terminalBrightRed: "rgb(204, 61, 81)",
  terminalBrightGreen: "rgb(46, 138, 76)",
  terminalBrightYellow: "rgb(184, 137, 14)",
  terminalBrightBlue: "rgb(40, 105, 189)",
  terminalBrightMagenta: "rgb(143, 84, 191)",
  terminalBrightCyan: "rgb(24, 139, 148)",
  terminalBrightWhite: "rgb(44, 53, 66)",

  // Diff
  diffAddedBackground: "#dcfce7",
  diffRemovedBackground: "#fee2e2",

  // Inputs & Controls
  inputBackground: "rgba(0, 0, 0, 0.04)",
  inputBorder: "rgba(0, 0, 0, 0.1)",

  // Buttons
  primaryButton: "oklch(0.488 0.217 264)",
  primaryButtonForeground: "#ffffff",
  secondaryButton: "rgba(0, 0, 0, 0.04)",
  destructiveButton: "#ef4444",
  destructiveButtonForeground: "#b91c1c",

  // Borders
  border: "rgba(0, 0, 0, 0.08)",
  radius: "0.625rem",

  // Semantic Status
  info: "#3b82f6",
  infoForeground: "#1d4ed8",
  success: "#10b981",
  successForeground: "#047857",
  warning: "#f59e0b",
  warningForeground: "#b45309",
  destructive: "#ef4444",
  destructiveForeground: "#b91c1c",
};

/**
 * Dark base theme color tokens.
 * Values extracted from index.css @variant dark {} block and ThreadTerminalDrawer.tsx dark palette.
 */
export const DARK_DEFAULTS: ResolvedColorTokens = {
  // App Chrome
  appChromeBackground: "#161616",

  // Sidebar
  sidebarBackground: "#161616",
  sidebarForeground: "#f3f4f6",
  sidebarBorder: "rgba(255, 255, 255, 0.08)",
  sidebarAccent: "rgba(255, 255, 255, 0.06)",
  sidebarAccentForeground: "#f3f4f6",

  // Main Content
  background: "#161616",
  foreground: "#f3f4f6",
  cardBackground: "#1a1a1a",
  cardForeground: "#f3f4f6",
  popoverBackground: "#1a1a1a",
  popoverForeground: "#f3f4f6",

  // Primary & Ring
  primary: "oklch(0.588 0.217 264)",
  primaryForeground: "#ffffff",
  ring: "oklch(0.588 0.217 264)",

  // Secondary / Muted / Accent
  secondary: "rgba(255, 255, 255, 0.06)",
  secondaryForeground: "#ffffff",
  muted: "rgba(255, 255, 255, 0.06)",
  mutedForeground: "#9ca3af",
  accent: "rgba(255, 255, 255, 0.06)",
  accentForeground: "#f3f4f6",

  // Code Blocks
  codeBackground: "#1e1e1e",
  codeBorder: "rgba(255, 255, 255, 0.08)",

  // Terminal (from ThreadTerminalDrawer.tsx dark palette)
  terminalBackground: "#0e1218",
  terminalForeground: "#edf1f7",
  terminalCursor: "rgb(180, 203, 255)",
  terminalSelectionBackground: "rgba(180, 203, 255, 0.2)",
  terminalBlack: "rgb(24, 30, 38)",
  terminalRed: "rgb(255, 122, 142)",
  terminalGreen: "rgb(134, 231, 149)",
  terminalYellow: "rgb(244, 205, 114)",
  terminalBlue: "rgb(137, 190, 255)",
  terminalMagenta: "rgb(208, 176, 255)",
  terminalCyan: "rgb(124, 232, 237)",
  terminalWhite: "rgb(210, 218, 230)",
  terminalBrightBlack: "rgb(110, 120, 136)",
  terminalBrightRed: "rgb(255, 153, 168)",
  terminalBrightGreen: "rgb(164, 243, 176)",
  terminalBrightYellow: "rgb(249, 220, 153)",
  terminalBrightBlue: "rgb(173, 212, 255)",
  terminalBrightMagenta: "rgb(224, 204, 255)",
  terminalBrightCyan: "rgb(167, 242, 246)",
  terminalBrightWhite: "rgb(237, 241, 247)",

  // Diff
  diffAddedBackground: "rgba(16, 185, 129, 0.15)",
  diffRemovedBackground: "rgba(239, 68, 68, 0.15)",

  // Inputs & Controls
  inputBackground: "rgba(255, 255, 255, 0.06)",
  inputBorder: "rgba(255, 255, 255, 0.1)",

  // Buttons
  primaryButton: "oklch(0.588 0.217 264)",
  primaryButtonForeground: "#ffffff",
  secondaryButton: "rgba(255, 255, 255, 0.06)",
  destructiveButton: "#ef4444",
  destructiveButtonForeground: "#fca5a5",

  // Borders
  border: "rgba(255, 255, 255, 0.08)",
  radius: "0.625rem",

  // Semantic Status
  info: "#3b82f6",
  infoForeground: "#60a5fa",
  success: "#10b981",
  successForeground: "#34d399",
  warning: "#f59e0b",
  warningForeground: "#fbbf24",
  destructive: "#ef4444",
  destructiveForeground: "#fca5a5",
};
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run apps/web/src/theme/defaults.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/theme/defaults.ts apps/web/src/theme/defaults.test.ts
git commit -m "feat(web): extract base theme defaults from CSS into TypeScript"
```

---

## Task 3: Theme Merge / Resolution Logic

Pure function that deep-merges sparse user overrides onto a base theme's defaults to produce a fully resolved theme.

**Files:**

- Create: `apps/web/src/theme/engine.ts`
- Test: `apps/web/src/theme/engine.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/theme/engine.test.ts
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./engine";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";
import type { Theme } from "@t3tools/contracts";

const makeTheme = (partial: Partial<Theme> & Pick<Theme, "id" | "name" | "base">): Theme => ({
  overrides: {},
  metadata: { version: 1, createdAt: "", updatedAt: "" },
  ...partial,
});

describe("resolveTheme", () => {
  it("returns light defaults when base is light and no overrides", () => {
    const theme = makeTheme({ id: "1", name: "Test", base: "light" });
    const resolved = resolveTheme(theme);
    expect(resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
    expect(resolved.colors.foreground).toBe(LIGHT_DEFAULTS.foreground);
    expect(resolved.colors.primary).toBe(LIGHT_DEFAULTS.primary);
    expect(resolved.base).toBe("light");
  });

  it("returns dark defaults when base is dark and no overrides", () => {
    const theme = makeTheme({ id: "2", name: "Test", base: "dark" });
    const resolved = resolveTheme(theme);
    expect(resolved.colors.background).toBe(DARK_DEFAULTS.background);
    expect(resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
  });

  it("applies color overrides on top of base defaults", () => {
    const theme = makeTheme({
      id: "3",
      name: "Custom",
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
    // Non-overridden tokens fall through to dark defaults
    expect(resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
    expect(resolved.colors.border).toBe(DARK_DEFAULTS.border);
  });

  it("applies typography overrides with defaults for unset values", () => {
    const theme = makeTheme({
      id: "4",
      name: "Custom",
      base: "light",
      overrides: {
        typography: { codeFontFamily: "Fira Code, monospace" },
      },
    });
    const resolved = resolveTheme(theme);
    expect(resolved.typography.codeFontFamily).toBe("Fira Code, monospace");
    expect(resolved.typography.uiFontFamily).toContain("sans-serif");
  });

  it("applies transparency overrides with defaults for unset values", () => {
    const theme = makeTheme({
      id: "5",
      name: "Custom",
      base: "dark",
      overrides: {
        transparency: { windowOpacity: 0.85 },
      },
    });
    const resolved = resolveTheme(theme);
    expect(resolved.transparency.windowOpacity).toBe(0.85);
    expect(resolved.transparency.vibrancy).toBe("none");
  });

  it("preserves theme id and name", () => {
    const theme = makeTheme({ id: "my-id", name: "My Theme", base: "light" });
    const resolved = resolveTheme(theme);
    expect(resolved.id).toBe("my-id");
    expect(resolved.name).toBe("My Theme");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/web/src/theme/engine.test.ts`
Expected: FAIL — module `./engine` not found

**Step 3: Write the implementation**

```typescript
// apps/web/src/theme/engine.ts
import type {
  Theme,
  ResolvedTheme,
  ResolvedColorTokens,
  TypographyTokens,
  TransparencyTokens,
  ThemeBase,
} from "@t3tools/contracts";
import { DEFAULT_TYPOGRAPHY_TOKENS, DEFAULT_TRANSPARENCY_TOKENS } from "@t3tools/contracts";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

function getBaseColors(base: ThemeBase): ResolvedColorTokens {
  return base === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

function mergeColors(
  base: ResolvedColorTokens,
  overrides: Partial<Record<string, string | undefined>> | undefined,
): ResolvedColorTokens {
  if (!overrides) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && key in base) {
      (result as Record<string, string>)[key] = value;
    }
  }
  return result;
}

function mergeTypography(
  overrides: Partial<TypographyTokens> | undefined,
): Required<TypographyTokens> {
  if (!overrides) return { ...DEFAULT_TYPOGRAPHY_TOKENS };
  return {
    ...DEFAULT_TYPOGRAPHY_TOKENS,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  };
}

function mergeTransparency(
  overrides: Partial<TransparencyTokens> | undefined,
): Required<TransparencyTokens> {
  if (!overrides) return { ...DEFAULT_TRANSPARENCY_TOKENS };
  return {
    ...DEFAULT_TRANSPARENCY_TOKENS,
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)),
  };
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  const baseColors = getBaseColors(theme.base);
  return {
    id: theme.id,
    name: theme.name,
    base: theme.base,
    colors: mergeColors(baseColors, theme.overrides.colors as Record<string, string | undefined>),
    typography: mergeTypography(theme.overrides.typography),
    transparency: mergeTransparency(theme.overrides.transparency),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run apps/web/src/theme/engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/theme/engine.ts apps/web/src/theme/engine.test.ts
git commit -m "feat(web): add theme resolution engine with merge logic"
```

---

## Task 4: CSS Applicator

Maps resolved theme tokens to CSS custom properties and writes them to `document.documentElement.style`.

**Files:**

- Create: `apps/web/src/theme/applicator.ts`
- Test: `apps/web/src/theme/applicator.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/theme/applicator.test.ts
import { describe, expect, it } from "vitest";
import { colorTokenToCssProperty, buildCssPropertyMap } from "./applicator";
import { LIGHT_DEFAULTS } from "./defaults";

describe("colorTokenToCssProperty", () => {
  it("maps camelCase token names to --kebab-case CSS properties", () => {
    expect(colorTokenToCssProperty("background")).toBe("--background");
    expect(colorTokenToCssProperty("appChromeBackground")).toBe("--app-chrome-background");
    expect(colorTokenToCssProperty("sidebarAccentForeground")).toBe("--sidebar-accent-foreground");
    expect(colorTokenToCssProperty("primaryForeground")).toBe("--primary-foreground");
    expect(colorTokenToCssProperty("terminalBrightRed")).toBe("--terminal-bright-red");
  });
});

describe("buildCssPropertyMap", () => {
  it("returns a map of CSS property names to values", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    expect(map["--background"]).toBe(LIGHT_DEFAULTS.background);
    expect(map["--foreground"]).toBe(LIGHT_DEFAULTS.foreground);
    expect(map["--primary"]).toBe(LIGHT_DEFAULTS.primary);
    expect(map["--app-chrome-background"]).toBe(LIGHT_DEFAULTS.appChromeBackground);
    expect(map["--terminal-bright-red"]).toBe(LIGHT_DEFAULTS.terminalBrightRed);
  });

  it("includes every token from the input", () => {
    const map = buildCssPropertyMap(LIGHT_DEFAULTS);
    const tokenCount = Object.keys(LIGHT_DEFAULTS).length;
    const mapCount = Object.keys(map).length;
    expect(mapCount).toBe(tokenCount);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/web/src/theme/applicator.test.ts`
Expected: FAIL — module `./applicator` not found

**Step 3: Write the implementation**

```typescript
// apps/web/src/theme/applicator.ts
import type { ResolvedColorTokens } from "@t3tools/contracts";

/**
 * Converts a camelCase token name to a --kebab-case CSS custom property.
 * e.g. "appChromeBackground" -> "--app-chrome-background"
 */
export function colorTokenToCssProperty(tokenName: string): string {
  const kebab = tokenName.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  return `--${kebab}`;
}

/**
 * Builds a flat map of CSS custom property names to values
 * from a resolved color tokens object.
 */
export function buildCssPropertyMap(tokens: ResolvedColorTokens): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    map[colorTokenToCssProperty(key)] = value;
  }
  return map;
}

/**
 * Applies resolved color tokens as CSS custom properties on a target element.
 * Typically called with `document.documentElement` to set `:root` properties.
 */
export function applyCssTokens(element: HTMLElement, tokens: ResolvedColorTokens): void {
  const map = buildCssPropertyMap(tokens);
  for (const [property, value] of Object.entries(map)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Clears all theme-engine-applied CSS custom properties from an element.
 * Used when resetting to CSS-defined defaults.
 */
export function clearCssTokens(element: HTMLElement, tokens: ResolvedColorTokens): void {
  for (const key of Object.keys(tokens)) {
    element.style.removeProperty(colorTokenToCssProperty(key));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run apps/web/src/theme/applicator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/theme/applicator.ts apps/web/src/theme/applicator.test.ts
git commit -m "feat(web): add CSS applicator for theme tokens"
```

---

## Task 5: Terminal Theme Mapper

Maps resolved terminal color tokens to an xterm.js `ITheme` object, replacing the hardcoded palette in `ThreadTerminalDrawer.tsx`.

**Files:**

- Create: `apps/web/src/theme/terminal-mapper.ts`
- Test: `apps/web/src/theme/terminal-mapper.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/theme/terminal-mapper.test.ts
import { describe, expect, it } from "vitest";
import { buildTerminalTheme } from "./terminal-mapper";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

describe("buildTerminalTheme", () => {
  it("maps dark defaults to a valid xterm ITheme", () => {
    const itheme = buildTerminalTheme(DARK_DEFAULTS);
    expect(itheme.background).toBe(DARK_DEFAULTS.terminalBackground);
    expect(itheme.foreground).toBe(DARK_DEFAULTS.terminalForeground);
    expect(itheme.cursor).toBe(DARK_DEFAULTS.terminalCursor);
    expect(itheme.selectionBackground).toBe(DARK_DEFAULTS.terminalSelectionBackground);
    expect(itheme.black).toBe(DARK_DEFAULTS.terminalBlack);
    expect(itheme.red).toBe(DARK_DEFAULTS.terminalRed);
    expect(itheme.green).toBe(DARK_DEFAULTS.terminalGreen);
    expect(itheme.yellow).toBe(DARK_DEFAULTS.terminalYellow);
    expect(itheme.blue).toBe(DARK_DEFAULTS.terminalBlue);
    expect(itheme.magenta).toBe(DARK_DEFAULTS.terminalMagenta);
    expect(itheme.cyan).toBe(DARK_DEFAULTS.terminalCyan);
    expect(itheme.white).toBe(DARK_DEFAULTS.terminalWhite);
    expect(itheme.brightBlack).toBe(DARK_DEFAULTS.terminalBrightBlack);
    expect(itheme.brightRed).toBe(DARK_DEFAULTS.terminalBrightRed);
    expect(itheme.brightGreen).toBe(DARK_DEFAULTS.terminalBrightGreen);
    expect(itheme.brightYellow).toBe(DARK_DEFAULTS.terminalBrightYellow);
    expect(itheme.brightBlue).toBe(DARK_DEFAULTS.terminalBrightBlue);
    expect(itheme.brightMagenta).toBe(DARK_DEFAULTS.terminalBrightMagenta);
    expect(itheme.brightCyan).toBe(DARK_DEFAULTS.terminalBrightCyan);
    expect(itheme.brightWhite).toBe(DARK_DEFAULTS.terminalBrightWhite);
  });

  it("maps light defaults to a valid xterm ITheme", () => {
    const itheme = buildTerminalTheme(LIGHT_DEFAULTS);
    expect(itheme.background).toBe(LIGHT_DEFAULTS.terminalBackground);
    expect(itheme.foreground).toBe(LIGHT_DEFAULTS.terminalForeground);
  });

  it("uses custom token values when provided", () => {
    const custom = { ...DARK_DEFAULTS, terminalRed: "#ff0000" };
    const itheme = buildTerminalTheme(custom);
    expect(itheme.red).toBe("#ff0000");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/web/src/theme/terminal-mapper.test.ts`
Expected: FAIL — module `./terminal-mapper` not found

**Step 3: Write the implementation**

```typescript
// apps/web/src/theme/terminal-mapper.ts
import type { ResolvedColorTokens } from "@t3tools/contracts";

/**
 * xterm.js ITheme shape (subset we use).
 * We define our own interface to avoid importing @xterm/xterm in non-terminal code.
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
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run apps/web/src/theme/terminal-mapper.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/theme/terminal-mapper.ts apps/web/src/theme/terminal-mapper.test.ts
git commit -m "feat(web): add terminal theme mapper for xterm.js"
```

---

## Task 6: Theme Store

Reactive store managing theme lifecycle: loading, resolution, persistence, and change notification. Replaces the hand-rolled store in `useTheme.ts`.

**Files:**

- Create: `apps/web/src/theme/store.ts`
- Test: `apps/web/src/theme/store.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/theme/store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeStore } from "./store";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("ThemeStore", () => {
  let store: ThemeStore;

  beforeEach(() => {
    localStorageMock.clear();
    store = new ThemeStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with dark default theme when no stored preference", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("dark");
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("initializes with stored base theme preference", () => {
    localStorageMock.setItem("t3code:theme", "light");
    store = new ThemeStore();
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("light");
    expect(snapshot.resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
  });

  it("switches base theme and notifies listeners", () => {
    const listener = vi.fn();
    store.subscribe(listener);

    store.setBase("light");

    expect(listener).toHaveBeenCalled();
    const snapshot = store.getSnapshot();
    expect(snapshot.base).toBe("light");
    expect(snapshot.resolved.colors.background).toBe(LIGHT_DEFAULTS.background);
  });

  it("sets individual color token overrides", () => {
    store.setColorToken("background", "#ff0000");
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe("#ff0000");
    // Other tokens unchanged
    expect(snapshot.resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);
  });

  it("resets individual color token to base default", () => {
    store.setColorToken("background", "#ff0000");
    store.resetColorToken("background");
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("tracks which tokens are overridden", () => {
    expect(store.isColorTokenOverridden("background")).toBe(false);
    store.setColorToken("background", "#ff0000");
    expect(store.isColorTokenOverridden("background")).toBe(true);
    store.resetColorToken("background");
    expect(store.isColorTokenOverridden("background")).toBe(false);
  });

  it("creates a new custom theme", () => {
    store.createTheme("My Theme", "dark");
    const snapshot = store.getSnapshot();
    expect(snapshot.theme.name).toBe("My Theme");
    expect(snapshot.theme.base).toBe("dark");
    expect(snapshot.theme.id).toBeDefined();
    expect(snapshot.isCustom).toBe(true);
  });

  it("discards unsaved changes", () => {
    store.createTheme("My Theme", "dark");
    store.setColorToken("background", "#ff0000");
    store.discardChanges();
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe(DARK_DEFAULTS.background);
  });

  it("exports theme as JSON string", () => {
    store.createTheme("Export Test", "light");
    store.setColorToken("primary", "#abc123");
    const json = store.exportTheme();
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("Export Test");
    expect(parsed.base).toBe("light");
    expect(parsed.overrides.colors.primary).toBe("#abc123");
  });

  it("imports theme from JSON string", () => {
    const json = JSON.stringify({
      id: "imported-1",
      name: "Imported",
      base: "dark",
      overrides: { colors: { background: "#123456" } },
      metadata: { version: 1, createdAt: "", updatedAt: "" },
    });
    store.importTheme(json);
    const snapshot = store.getSnapshot();
    expect(snapshot.theme.name).toBe("Imported");
    expect(snapshot.resolved.colors.background).toBe("#123456");
    expect(snapshot.isCustom).toBe(true);
  });

  it("lists saved themes", () => {
    store.createTheme("Theme A", "dark");
    store.createTheme("Theme B", "light");
    const list = store.listThemes();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("unsubscribe stops notifications", () => {
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setBase("light");
    expect(listener).not.toHaveBeenCalled();
  });

  it("resolvedTheme returns light or dark for backwards compat", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.resolvedTheme).toBe("dark");
    store.setBase("light");
    expect(store.getSnapshot().resolvedTheme).toBe("light");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest run apps/web/src/theme/store.test.ts`
Expected: FAIL — module `./store` not found

**Step 3: Write the implementation**

```typescript
// apps/web/src/theme/store.ts
import type { Theme, ResolvedTheme, ThemeBase, ColorTokens } from "@t3tools/contracts";
import { Schema } from "effect";
import { ThemeSchema } from "@t3tools/contracts";
import { resolveTheme } from "./engine";

const THEME_KEY = "t3code:theme";
const CUSTOM_THEMES_KEY = "t3code:custom-themes:v1";
const ACTIVE_THEME_KEY = "t3code:active-theme-id:v1";

export interface ThemeStoreSnapshot {
  /** The raw theme definition (may have sparse overrides). */
  readonly theme: Theme;
  /** Fully resolved theme with all tokens filled. */
  readonly resolved: ResolvedTheme;
  /** The legacy "light" | "dark" resolved value for backwards compat. */
  readonly resolvedTheme: "light" | "dark";
  /** The user preference: "light" | "dark" | "system". */
  readonly preference: "light" | "dark" | "system";
  /** Whether the active theme is a user-created custom theme. */
  readonly isCustom: boolean;
  /** Whether there are unsaved changes since last persist. */
  readonly isDirty: boolean;
}

function generateId(): string {
  return crypto.randomUUID();
}

function makeDefaultTheme(base: ThemeBase): Theme {
  return {
    id: `default-${base}`,
    name: base === "dark" ? "Dark Default" : "Light Default",
    base,
    overrides: {},
    metadata: {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function loadStoredPreference(): "light" | "dark" | "system" {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return "system";
}

function resolveBaseFromPreference(preference: "light" | "dark" | "system"): ThemeBase {
  if (preference === "system") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }
  return preference;
}

function loadSavedThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item: unknown) => {
        try {
          return Schema.decodeUnknownSync(ThemeSchema)(item);
        } catch {
          return null;
        }
      })
      .filter((t: Theme | null): t is Theme => t !== null);
  } catch {
    return [];
  }
}

function saveSavedThemes(themes: Theme[]): void {
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  } catch {
    // localStorage unavailable
  }
}

function loadActiveThemeId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_THEME_KEY);
  } catch {
    return null;
  }
}

function saveActiveThemeId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_THEME_KEY, id);
  } catch {
    // localStorage unavailable
  }
}

export class ThemeStore {
  private listeners: Array<() => void> = [];
  private snapshot: ThemeStoreSnapshot;
  private savedThemes: Theme[];
  private preference: "light" | "dark" | "system";
  private lastSavedTheme: Theme;
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.preference = loadStoredPreference();
    this.savedThemes = loadSavedThemes();

    const activeId = loadActiveThemeId();
    const activeCustom = activeId ? this.savedThemes.find((t) => t.id === activeId) : undefined;

    const base = resolveBaseFromPreference(this.preference);
    const theme = activeCustom ?? makeDefaultTheme(base);

    // If using a default theme, ensure the base matches the preference
    if (!activeCustom) {
      theme.base = base;
    }

    this.lastSavedTheme = structuredClone(theme);
    this.snapshot = this.buildSnapshot(theme, false);
  }

  private buildSnapshot(theme: Theme, isDirty: boolean): ThemeStoreSnapshot {
    const resolved = resolveTheme(theme);
    return {
      theme,
      resolved,
      resolvedTheme: theme.base,
      preference: this.preference,
      isCustom: !theme.id.startsWith("default-"),
      isDirty,
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private update(theme: Theme, isDirty: boolean): void {
    this.snapshot = this.buildSnapshot(theme, isDirty);
    this.emit();
  }

  // --- Public API ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  };

  getSnapshot = (): ThemeStoreSnapshot => {
    return this.snapshot;
  };

  setBase(base: ThemeBase): void {
    this.preference = base;
    try {
      localStorage.setItem(THEME_KEY, base);
    } catch {
      // localStorage unavailable
    }

    const theme = { ...this.snapshot.theme, base };
    this.update(theme, this.snapshot.isCustom);
    this.schedulePersist();
  }

  setPreference(preference: "light" | "dark" | "system"): void {
    this.preference = preference;
    try {
      localStorage.setItem(THEME_KEY, preference);
    } catch {
      // localStorage unavailable
    }

    const base = resolveBaseFromPreference(preference);
    if (!this.snapshot.isCustom) {
      const theme = makeDefaultTheme(base);
      this.lastSavedTheme = structuredClone(theme);
      this.update(theme, false);
    } else {
      // Custom theme: update base
      const theme = { ...this.snapshot.theme, base };
      this.update(theme, true);
      this.schedulePersist();
    }
  }

  setColorToken(tokenName: keyof ColorTokens, value: string): void {
    const theme = structuredClone(this.snapshot.theme);
    if (!theme.overrides.colors) {
      theme.overrides.colors = {};
    }
    (theme.overrides.colors as Record<string, string>)[tokenName] = value;
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  resetColorToken(tokenName: keyof ColorTokens): void {
    const theme = structuredClone(this.snapshot.theme);
    if (theme.overrides.colors) {
      delete (theme.overrides.colors as Record<string, string | undefined>)[tokenName];
    }
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  isColorTokenOverridden(tokenName: keyof ColorTokens): boolean {
    const colors = this.snapshot.theme.overrides.colors;
    if (!colors) return false;
    return (colors as Record<string, unknown>)[tokenName] !== undefined;
  }

  createTheme(name: string, base: ThemeBase): void {
    const theme: Theme = {
      id: generateId(),
      name,
      base,
      overrides: {},
      metadata: {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    this.savedThemes.push(theme);
    saveSavedThemes(this.savedThemes);
    saveActiveThemeId(theme.id);
    this.lastSavedTheme = structuredClone(theme);
    this.update(theme, false);
  }

  duplicateTheme(name: string): void {
    const current = structuredClone(this.snapshot.theme);
    current.id = generateId();
    current.name = name;
    current.metadata.createdAt = new Date().toISOString();
    current.metadata.updatedAt = new Date().toISOString();
    this.savedThemes.push(current);
    saveSavedThemes(this.savedThemes);
    saveActiveThemeId(current.id);
    this.lastSavedTheme = structuredClone(current);
    this.update(current, false);
  }

  deleteTheme(): void {
    const id = this.snapshot.theme.id;
    this.savedThemes = this.savedThemes.filter((t) => t.id !== id);
    saveSavedThemes(this.savedThemes);

    const base = resolveBaseFromPreference(this.preference);
    const theme = makeDefaultTheme(base);
    saveActiveThemeId(theme.id);
    this.lastSavedTheme = structuredClone(theme);
    this.update(theme, false);
  }

  selectTheme(id: string): void {
    if (id.startsWith("default-")) {
      const base = id === "default-light" ? "light" : "dark";
      const theme = makeDefaultTheme(base as ThemeBase);
      saveActiveThemeId(theme.id);
      this.lastSavedTheme = structuredClone(theme);
      this.update(theme, false);
      return;
    }
    const found = this.savedThemes.find((t) => t.id === id);
    if (found) {
      saveActiveThemeId(found.id);
      this.lastSavedTheme = structuredClone(found);
      this.update(found, false);
    }
  }

  discardChanges(): void {
    const theme = structuredClone(this.lastSavedTheme);
    this.update(theme, false);
  }

  exportTheme(): string {
    return JSON.stringify(this.snapshot.theme, null, 2);
  }

  importTheme(json: string): void {
    const parsed = JSON.parse(json);
    const theme = Schema.decodeUnknownSync(ThemeSchema)(parsed);
    // Ensure unique ID on import
    theme.id = generateId();
    this.savedThemes.push(theme);
    saveSavedThemes(this.savedThemes);
    saveActiveThemeId(theme.id);
    this.lastSavedTheme = structuredClone(theme);
    this.update(theme, false);
  }

  listThemes(): Array<{ id: string; name: string; base: ThemeBase }> {
    return [
      { id: "default-dark", name: "Dark Default", base: "dark" as ThemeBase },
      { id: "default-light", name: "Light Default", base: "light" as ThemeBase },
      ...this.savedThemes.map((t) => ({ id: t.id, name: t.name, base: t.base })),
    ];
  }

  private schedulePersist(): void {
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
    }
    this.persistTimeout = setTimeout(() => {
      this.persist();
    }, 300);
  }

  private persist(): void {
    const theme = this.snapshot.theme;
    if (theme.id.startsWith("default-")) return;

    const idx = this.savedThemes.findIndex((t) => t.id === theme.id);
    if (idx >= 0) {
      this.savedThemes[idx] = structuredClone(theme);
    }
    saveSavedThemes(this.savedThemes);
    this.lastSavedTheme = structuredClone(theme);
    this.snapshot = this.buildSnapshot(theme, false);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun vitest run apps/web/src/theme/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/theme/store.ts apps/web/src/theme/store.test.ts
git commit -m "feat(web): add ThemeStore with persistence and change tracking"
```

---

## Task 7: Rewrite useTheme Hook

Replace the existing `useTheme.ts` with a thin wrapper around ThemeStore. Must maintain backwards compatibility — same `{ theme, setTheme, resolvedTheme }` return type for existing consumers.

**Files:**

- Modify: `apps/web/src/hooks/useTheme.ts`
- Create: `apps/web/src/theme/index.ts` (singleton store instance + barrel export)
- Modify: `apps/web/index.html` (update pre-hydration script)

**Step 1: Create the theme barrel export with singleton store**

```typescript
// apps/web/src/theme/index.ts
export { ThemeStore } from "./store";
export type { ThemeStoreSnapshot } from "./store";
export { resolveTheme } from "./engine";
export {
  applyCssTokens,
  clearCssTokens,
  colorTokenToCssProperty,
  buildCssPropertyMap,
} from "./applicator";
export { buildTerminalTheme } from "./terminal-mapper";
export type { TerminalTheme } from "./terminal-mapper";
export { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

import { ThemeStore } from "./store";
import { applyCssTokens } from "./applicator";

// Singleton store instance — initialized once on module load
export const themeStore = new ThemeStore();

/**
 * Apply the current theme to the DOM immediately.
 * Called on module load and on every theme change.
 */
function applyThemeToDom(): void {
  const { resolved, resolvedTheme } = themeStore.getSnapshot();
  const root = document.documentElement;

  // Toggle dark class for Tailwind dark: variant
  root.classList.toggle("dark", resolvedTheme === "dark");

  // Apply all color tokens as CSS custom properties
  applyCssTokens(root, resolved.colors);

  // Set background for Electron chrome sync
  root.style.backgroundColor = resolved.colors.appChromeBackground;
  document.body.style.backgroundColor = resolved.colors.appChromeBackground;

  // Update meta theme-color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved.colors.appChromeBackground);
  }

  // Sync to Electron desktop bridge
  if (window.desktopBridge?.setTheme) {
    window.desktopBridge.setTheme(resolvedTheme).catch(() => {});
  }
}

// Apply immediately on load
applyThemeToDom();

// Re-apply on every store change
themeStore.subscribe(() => {
  applyThemeToDom();
});
```

**Step 2: Rewrite useTheme hook**

Read the existing file first, then replace its contents:

```typescript
// apps/web/src/hooks/useTheme.ts
import { useSyncExternalStore } from "react";
import { themeStore } from "../theme";
import type { ThemeStoreSnapshot } from "../theme";

type Theme = "light" | "dark" | "system";

interface UseThemeReturn {
  /** The user's preference: "light" | "dark" | "system". */
  theme: Theme;
  /** Set the theme preference. */
  setTheme: (theme: Theme) => void;
  /** The resolved theme after evaluating system preference: always "light" | "dark". */
  resolvedTheme: "light" | "dark";
  /** The full theme store snapshot (for the theme editor). */
  themeSnapshot: ThemeStoreSnapshot;
}

export function useTheme(): UseThemeReturn {
  const snapshot = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getSnapshot,
  );

  return {
    theme: snapshot.preference,
    setTheme: (t: Theme) => themeStore.setPreference(t),
    resolvedTheme: snapshot.resolvedTheme,
    themeSnapshot: snapshot,
  };
}

/**
 * Sync browser chrome (meta theme-color, background) to current theme.
 * Called from route changes. Now mostly a no-op since the store subscription
 * handles this, but kept for compatibility.
 */
export function syncBrowserChromeTheme(): void {
  const { resolved } = themeStore.getSnapshot();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved.colors.appChromeBackground);
  }
  document.documentElement.style.backgroundColor = resolved.colors.appChromeBackground;
  document.body.style.backgroundColor = resolved.colors.appChromeBackground;
}
```

**Step 3: Update pre-hydration script in index.html**

The inline script needs to also load custom theme data to prevent flash. Update `apps/web/index.html` pre-hydration script to read the active theme's background color from localStorage if a custom theme is active:

```html
<script>
  (() => {
    const LIGHT_BACKGROUND = "#ffffff";
    const DARK_BACKGROUND = "#161616";
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    try {
      const storedTheme = window.localStorage.getItem("t3code:theme");
      const theme =
        storedTheme === "light" || storedTheme === "dark" || storedTheme === "system"
          ? storedTheme
          : "system";
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDark = theme === "dark" || (theme === "system" && prefersDark);
      document.documentElement.classList.toggle("dark", isDark);

      // Try to load custom theme background for flash prevention
      let chromeColor = isDark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
      try {
        const activeId = window.localStorage.getItem("t3code:active-theme-id:v1");
        if (activeId && !activeId.startsWith("default-")) {
          const themes = JSON.parse(window.localStorage.getItem("t3code:custom-themes:v1") || "[]");
          const active = themes.find((t) => t.id === activeId);
          if (active?.overrides?.colors?.appChromeBackground) {
            chromeColor = active.overrides.colors.appChromeBackground;
          } else if (active?.overrides?.colors?.background) {
            chromeColor = active.overrides.colors.background;
          }
        }
      } catch {
        /* custom theme load failed, use default */
      }

      document.documentElement.style.backgroundColor = chromeColor;
      themeColorMeta?.setAttribute("content", chromeColor);
    } catch {
      document.documentElement.classList.add("dark");
      document.documentElement.style.backgroundColor = DARK_BACKGROUND;
      themeColorMeta?.setAttribute("content", DARK_BACKGROUND);
    }
  })();
</script>
```

**Step 4: Run existing tests to verify nothing is broken**

Run: `bun vitest run apps/web/src/`
Expected: PASS — all existing tests should still pass since the `useTheme` API shape is preserved

**Step 5: Commit**

```bash
git add apps/web/src/theme/index.ts apps/web/src/hooks/useTheme.ts apps/web/index.html
git commit -m "feat(web): rewrite useTheme to use ThemeStore engine"
```

---

## Task 8: New UI Components — Slider and ColorPicker

The theme editor needs two UI primitives that don't exist yet.

**Files:**

- Create: `apps/web/src/components/ui/slider.tsx`
- Create: `apps/web/src/components/ui/color-picker.tsx`

### Subtask 8a: Slider Component

**Step 1: Write the Slider component**

```typescript
// apps/web/src/components/ui/slider.tsx
import * as React from "react";
import { cn } from "../../lib/utils";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  disabled = false,
}: SliderProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  return (
    <input
      type="range"
      value={value}
      onChange={handleChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    />
  );
}
```

### Subtask 8b: ColorPicker Component

**Step 2: Write the ColorPicker component**

```typescript
// apps/web/src/components/ui/color-picker.tsx
import * as React from "react";
import { cn } from "../../lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  className?: string;
  disabled?: boolean;
}

export function ColorPicker({
  value,
  onChange,
  className,
  disabled = false,
}: ColorPickerProps) {
  const [hexInput, setHexInput] = React.useState(value);

  React.useEffect(() => {
    setHexInput(value);
  }, [value]);

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setHexInput(newValue);
    // Only propagate valid-looking color values
    if (/^#[0-9a-fA-F]{3,8}$/.test(newValue) || /^(rgb|oklch|hsl)\(/.test(newValue)) {
      onChange(newValue);
    }
  };

  const handleHexBlur = () => {
    // On blur, if the value looks invalid, revert to prop value
    setHexInput(value);
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    onChange(color);
    setHexInput(color);
  };

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md border border-border px-2 py-1.5",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <div
          className="size-5 rounded border border-border/50"
          style={{ backgroundColor: value }}
        />
        <span className="font-mono text-xs text-muted-foreground">
          {value.length > 20 ? `${value.slice(0, 20)}...` : value}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="flex flex-col gap-3">
          {/* Native color picker for visual selection */}
          <input
            type="color"
            value={value.startsWith("#") ? value : "#000000"}
            onChange={handleNativeChange}
            className="h-32 w-full cursor-pointer rounded border-0 bg-transparent p-0"
            disabled={disabled}
          />
          {/* Hex text input for precise entry */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Value</label>
            <input
              type="text"
              value={hexInput}
              onChange={handleHexChange}
              onBlur={handleHexBlur}
              className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              placeholder="#000000"
              disabled={disabled}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/components/ui/slider.tsx apps/web/src/components/ui/color-picker.tsx
git commit -m "feat(web): add Slider and ColorPicker UI components"
```

---

## Task 9: Appearance Settings Route

Add the new `/settings/appearance` route and navigation entry.

**Files:**

- Create: `apps/web/src/routes/settings.appearance.tsx`
- Modify: `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- Create: `apps/web/src/components/settings/AppearanceSettings.tsx`

**Step 1: Create the route file**

```typescript
// apps/web/src/routes/settings.appearance.tsx
import { createFileRoute } from "@tanstack/react-router";
import { AppearanceSettings } from "../components/settings/AppearanceSettings";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettings,
});
```

**Step 2: Add navigation entry**

Read `apps/web/src/components/settings/SettingsSidebarNav.tsx`, then add the Appearance entry to `SETTINGS_NAV_ITEMS` and update the `SettingsSectionPath` type.

Add `PaletteIcon` to the lucide-react import, then add to the nav items array after "General":

```typescript
{ label: "Appearance", to: "/settings/appearance", icon: PaletteIcon },
```

And update the type:

```typescript
export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/connections"
  | "/settings/archived";
```

**Step 3: Create the AppearanceSettings shell component**

```typescript
// apps/web/src/components/settings/AppearanceSettings.tsx
import { SettingsPageContainer } from "./settingsLayout";

export function AppearanceSettings() {
  return (
    <SettingsPageContainer>
      <div className="text-foreground">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Customize colors, typography, transparency, and icons.
        </p>
      </div>
    </SettingsPageContainer>
  );
}
```

**Step 4: Verify the route renders**

Run: `bun dev:web` and navigate to `/settings/appearance`
Expected: The Appearance tab appears in the sidebar nav and renders the shell content

**Step 5: Commit**

```bash
git add apps/web/src/routes/settings.appearance.tsx apps/web/src/components/settings/SettingsSidebarNav.tsx apps/web/src/components/settings/AppearanceSettings.tsx
git commit -m "feat(web): add Appearance settings route and navigation"
```

---

## Task 10: Theme Editor Header

The top section of the Appearance settings page with theme selector, action buttons, and tab navigation.

**Files:**

- Modify: `apps/web/src/components/settings/AppearanceSettings.tsx`
- Create: `apps/web/src/components/settings/ThemeEditorHeader.tsx`
- Create: `apps/web/src/components/settings/ThemeEditorTabs.tsx`

**Step 1: Build the ThemeEditorHeader**

```typescript
// apps/web/src/components/settings/ThemeEditorHeader.tsx
import { useState } from "react";
import { DownloadIcon, ImportIcon, PlusIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useTheme } from "../../hooks/useTheme";
import { themeStore } from "../../theme";
import type { ThemeBase } from "@t3tools/contracts";

export function ThemeEditorHeader() {
  const { themeSnapshot } = useTheme();
  const themes = themeStore.listThemes();
  const [showNewDialog, setShowNewDialog] = useState(false);

  const handleSelectTheme = (id: string) => {
    themeStore.selectTheme(id);
  };

  const handleNewTheme = () => {
    const name = prompt("Theme name:");
    if (!name) return;
    const base = themeSnapshot.resolvedTheme as ThemeBase;
    themeStore.createTheme(name, base);
  };

  const handleDuplicate = () => {
    const name = prompt("Name for duplicate:", `${themeSnapshot.theme.name} (copy)`);
    if (!name) return;
    themeStore.duplicateTheme(name);
  };

  const handleDelete = () => {
    if (!themeSnapshot.isCustom) return;
    if (!confirm(`Delete "${themeSnapshot.theme.name}"?`)) return;
    themeStore.deleteTheme();
  };

  const handleExport = () => {
    const json = themeStore.exportTheme();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${themeSnapshot.theme.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        themeStore.importTheme(text);
      } catch (err) {
        alert(`Failed to import theme: ${err}`);
      }
    };
    input.click();
  };

  const handleDiscard = () => {
    themeStore.discardChanges();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={themeSnapshot.theme.id} onValueChange={handleSelectTheme}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {themes.map((t) => (
              <SelectItem key={t.id} value={t.id} hideIndicator>
                {t.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Button variant="ghost" size="icon" onClick={handleNewTheme} title="New Theme">
          <PlusIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleDuplicate} title="Duplicate">
          <CopyIcon className="size-4" />
        </Button>
        {themeSnapshot.isCustom && (
          <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete">
            <Trash2Icon className="size-4" />
          </Button>
        )}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" onClick={handleImport}>
          <ImportIcon className="size-3.5 mr-1.5" />
          Import
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExport}>
          <DownloadIcon className="size-3.5 mr-1.5" />
          Export
        </Button>

        {themeSnapshot.isDirty && (
          <Button variant="outline" size="sm" onClick={handleDiscard}>
            Discard Changes
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Build the tab navigation**

```typescript
// apps/web/src/components/settings/ThemeEditorTabs.tsx
import { cn } from "../../lib/utils";

export type ThemeEditorTab = "colors" | "typography" | "transparency" | "icons";

interface ThemeEditorTabsProps {
  activeTab: ThemeEditorTab;
  onTabChange: (tab: ThemeEditorTab) => void;
}

const TABS: Array<{ id: ThemeEditorTab; label: string }> = [
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "transparency", label: "Transparency" },
  { id: "icons", label: "Icons" },
];

export function ThemeEditorTabs({ activeTab, onTabChange }: ThemeEditorTabsProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

**Step 3: Wire into AppearanceSettings**

Update `apps/web/src/components/settings/AppearanceSettings.tsx`:

```typescript
// apps/web/src/components/settings/AppearanceSettings.tsx
import { useState } from "react";
import { SettingsPageContainer } from "./settingsLayout";
import { ThemeEditorHeader } from "./ThemeEditorHeader";
import { ThemeEditorTabs, type ThemeEditorTab } from "./ThemeEditorTabs";
import { ColorsPanel } from "./theme-editor/ColorsPanel";

export function AppearanceSettings() {
  const [activeTab, setActiveTab] = useState<ThemeEditorTab>("colors");

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-4">
        <ThemeEditorHeader />
        <ThemeEditorTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "colors" && <ColorsPanel />}
        {activeTab === "typography" && (
          <p className="text-sm text-muted-foreground">Typography settings coming in Phase 2.</p>
        )}
        {activeTab === "transparency" && (
          <p className="text-sm text-muted-foreground">Transparency settings coming in Phase 3.</p>
        )}
        {activeTab === "icons" && (
          <p className="text-sm text-muted-foreground">Icon set selection coming in Phase 4.</p>
        )}
      </div>
    </SettingsPageContainer>
  );
}
```

**Step 4: Commit**

```bash
git add apps/web/src/components/settings/ThemeEditorHeader.tsx apps/web/src/components/settings/ThemeEditorTabs.tsx apps/web/src/components/settings/AppearanceSettings.tsx
git commit -m "feat(web): add theme editor header with selector, actions, and tab nav"
```

---

## Task 11: Colors Panel

The main color editing UI with collapsible sections and per-token color pickers.

**Files:**

- Create: `apps/web/src/components/settings/theme-editor/ColorsPanel.tsx`
- Create: `apps/web/src/components/settings/theme-editor/ColorTokenRow.tsx`
- Create: `apps/web/src/components/settings/theme-editor/colorSections.ts`

**Step 1: Define the color sections metadata**

```typescript
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
    tokens: [{ key: "appChromeBackground", label: "Background" }],
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
```

**Step 2: Build the ColorTokenRow component**

```typescript
// apps/web/src/components/settings/theme-editor/ColorTokenRow.tsx
import { RotateCcwIcon } from "lucide-react";
import { ColorPicker } from "../../ui/color-picker";
import { Button } from "../../ui/button";
import { themeStore } from "../../../theme";
import { useTheme } from "../../../hooks/useTheme";
import type { ColorTokens } from "@t3tools/contracts";

interface ColorTokenRowProps {
  tokenKey: keyof ColorTokens;
  label: string;
}

export function ColorTokenRow({ tokenKey, label }: ColorTokenRowProps) {
  const { themeSnapshot } = useTheme();
  const currentValue = themeSnapshot.resolved.colors[tokenKey];
  const isOverridden = themeStore.isColorTokenOverridden(tokenKey);

  const handleChange = (color: string) => {
    themeStore.setColorToken(tokenKey, color);
  };

  const handleReset = () => {
    themeStore.resetColorToken(tokenKey);
  };

  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        {isOverridden && (
          <div className="size-1.5 rounded-full bg-primary" title="Customized" />
        )}
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ColorPicker value={currentValue} onChange={handleChange} />
        {isOverridden && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleReset}
            title="Reset to default"
          >
            <RotateCcwIcon className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Build the ColorsPanel**

```typescript
// apps/web/src/components/settings/theme-editor/ColorsPanel.tsx
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { COLOR_SECTIONS } from "./colorSections";
import { ColorTokenRow } from "./ColorTokenRow";

export function ColorsPanel() {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(COLOR_SECTIONS.map((s) => s.id)),
  );

  const toggleSection = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {COLOR_SECTIONS.map((section) => {
        const isExpanded = expanded.has(section.id);
        return (
          <div key={section.id} className="rounded-lg border border-border">
            <button
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/50"
            >
              {isExpanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
              {section.title}
              <span className="text-xs text-muted-foreground">
                ({section.tokens.length})
              </span>
            </button>
            {isExpanded && (
              <div className="border-t border-border px-3 pb-2">
                {section.tokens.map((token) => (
                  <ColorTokenRow
                    key={token.key}
                    tokenKey={token.key}
                    label={token.label}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 4: Verify the editor renders and live-editing works**

Run: `bun dev:web` and navigate to `/settings/appearance`
Expected: All 11 color sections render with collapsible headers. Clicking a color swatch opens the picker. Changing a color updates the app live.

**Step 5: Commit**

```bash
git add apps/web/src/components/settings/theme-editor/
git commit -m "feat(web): add Colors panel with per-token color picker editor"
```

---

## Task 12: Wire Up Terminal Theme Consumer

Replace the hardcoded terminal palette in `ThreadTerminalDrawer.tsx` with the theme engine's terminal mapper.

**Files:**

- Modify: `apps/web/src/components/ThreadTerminalDrawer.tsx`

**Step 1: Read the current `terminalThemeFromApp` function**

Read `apps/web/src/components/ThreadTerminalDrawer.tsx` lines 82-167.

**Step 2: Replace with theme-engine-driven palette**

Replace the `terminalThemeFromApp` function body to use the theme store:

```typescript
import { themeStore, buildTerminalTheme } from "../theme";
```

Replace the body of `terminalThemeFromApp` (keeping the function signature for compatibility):

```typescript
function terminalThemeFromApp(): ITheme {
  const { resolved } = themeStore.getSnapshot();
  return buildTerminalTheme(resolved.colors);
}
```

Remove the hardcoded dark/light ANSI color objects and the `normalizeComputedColor` helper if it's no longer used elsewhere in the file.

**Step 3: Run existing terminal tests**

Run: `bun vitest run apps/web/src/components/ThreadTerminalDrawer`
Expected: PASS (or adjust tests if they were asserting on specific hardcoded RGB values)

**Step 4: Commit**

```bash
git add apps/web/src/components/ThreadTerminalDrawer.tsx
git commit -m "refactor(web): use theme engine for terminal color palette"
```

---

## Task 13: Wire Up ComposerPromptEditor Theme Consumer

Replace the direct DOM class check with the theme store.

**Files:**

- Modify: `apps/web/src/components/ComposerPromptEditor.tsx`

**Step 1: Replace `resolvedThemeFromDocument`**

Find the `resolvedThemeFromDocument` function (around line 433-435) and replace:

```typescript
import { themeStore } from "../theme";

function resolvedThemeFromDocument(): "light" | "dark" {
  return themeStore.getSnapshot().resolvedTheme;
}
```

**Step 2: Run existing tests**

Run: `bun vitest run apps/web/src/components/ComposerPromptEditor`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/components/ComposerPromptEditor.tsx
git commit -m "refactor(web): use theme store in ComposerPromptEditor"
```

---

## Task 14: Remove Theme Row from General Settings

Since theme selection is now in the Appearance panel, remove the theme row from General settings and point users there instead.

**Files:**

- Modify: `apps/web/src/components/settings/SettingsPanels.tsx`

**Step 1: Read the current theme section**

Read the `THEME_OPTIONS` constant and the theme `SettingsRow` in `SettingsPanels.tsx`.

**Step 2: Replace with a link to Appearance**

Replace the theme `SettingsRow` (with Select control) with a simpler row that links to the Appearance panel:

```typescript
<SettingsRow
  title="Theme"
  description="Customize colors, fonts, and transparency."
  control={
    <Button
      variant="outline"
      size="sm"
      onClick={() => navigate({ to: "/settings/appearance", replace: true })}
    >
      Appearance Settings
    </Button>
  }
/>
```

Import `useNavigate` from `@tanstack/react-router` if not already imported.

Also update `useSettingsRestore` to remove the theme-specific restore logic (the theme store handles its own defaults).

**Step 3: Run existing settings tests**

Run: `bun vitest run apps/web/src/components/settings/`
Expected: PASS (may need to update test expectations if they checked for the theme Select)

**Step 4: Commit**

```bash
git add apps/web/src/components/settings/SettingsPanels.tsx
git commit -m "refactor(web): move theme control to Appearance settings"
```

---

## Task 15: Integration Testing

End-to-end verification that the theme engine works correctly across all surfaces.

**Files:**

- Create: `apps/web/src/theme/integration.test.ts`

**Step 1: Write integration tests**

```typescript
// apps/web/src/theme/integration.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ThemeStore } from "./store";
import { buildTerminalTheme } from "./terminal-mapper";
import { buildCssPropertyMap } from "./applicator";
import { DARK_DEFAULTS, LIGHT_DEFAULTS } from "./defaults";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

describe("Theme Engine Integration", () => {
  let store: ThemeStore;

  beforeEach(() => {
    localStorageMock.clear();
    store = new ThemeStore();
  });

  it("full lifecycle: create theme, customize, export, import", () => {
    // Create a custom theme
    store.createTheme("My Dark", "dark");
    expect(store.getSnapshot().isCustom).toBe(true);

    // Customize some colors
    store.setColorToken("background", "#1a1a2e");
    store.setColorToken("primary", "#e94560");
    store.setColorToken("terminalRed", "#ff6b6b");

    // Verify resolution
    const snapshot = store.getSnapshot();
    expect(snapshot.resolved.colors.background).toBe("#1a1a2e");
    expect(snapshot.resolved.colors.primary).toBe("#e94560");
    expect(snapshot.resolved.colors.terminalRed).toBe("#ff6b6b");
    // Non-overridden tokens use dark defaults
    expect(snapshot.resolved.colors.foreground).toBe(DARK_DEFAULTS.foreground);

    // Export
    const json = store.exportTheme();
    const parsed = JSON.parse(json);
    expect(parsed.overrides.colors.background).toBe("#1a1a2e");
    expect(parsed.overrides.colors.primary).toBe("#e94560");
    expect(parsed.overrides.colors.foreground).toBeUndefined(); // sparse

    // Import into a fresh store
    localStorageMock.clear();
    const store2 = new ThemeStore();
    store2.importTheme(json);
    expect(store2.getSnapshot().resolved.colors.background).toBe("#1a1a2e");
    expect(store2.getSnapshot().resolved.colors.primary).toBe("#e94560");
  });

  it("terminal theme mapper uses customized tokens", () => {
    store.createTheme("Terminal Custom", "dark");
    store.setColorToken("terminalRed", "#ff0000");
    store.setColorToken("terminalGreen", "#00ff00");

    const { resolved } = store.getSnapshot();
    const termTheme = buildTerminalTheme(resolved.colors);
    expect(termTheme.red).toBe("#ff0000");
    expect(termTheme.green).toBe("#00ff00");
    expect(termTheme.blue).toBe(DARK_DEFAULTS.terminalBlue); // not overridden
  });

  it("CSS property map uses customized tokens", () => {
    store.createTheme("CSS Custom", "light");
    store.setColorToken("background", "#fafafa");

    const { resolved } = store.getSnapshot();
    const cssMap = buildCssPropertyMap(resolved.colors);
    expect(cssMap["--background"]).toBe("#fafafa");
    expect(cssMap["--foreground"]).toBe(LIGHT_DEFAULTS.foreground);
  });

  it("switching themes preserves customizations per theme", () => {
    // Create two themes
    store.createTheme("Theme A", "dark");
    const idA = store.getSnapshot().theme.id;
    store.setColorToken("background", "#111111");

    store.createTheme("Theme B", "light");
    store.setColorToken("background", "#eeeeee");

    // Switch back to Theme A
    store.selectTheme(idA);
    expect(store.getSnapshot().resolved.colors.background).toBe("#111111");
  });
});
```

**Step 2: Run integration tests**

Run: `bun vitest run apps/web/src/theme/integration.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `bun run test`
Expected: PASS — no regressions across the entire project

**Step 4: Commit**

```bash
git add apps/web/src/theme/integration.test.ts
git commit -m "test(web): add theme engine integration tests"
```

---

## Task 16: Lint and Final Cleanup

**Step 1: Run linter**

Run: `bun run lint`
Expected: PASS — no lint errors in new files

**Step 2: Run formatter**

Run: `bun run fmt:check`
If issues: `bun run fmt`

**Step 3: Run full build**

Run: `bun run build`
Expected: PASS — no TypeScript errors, all packages build cleanly

**Step 4: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: lint and format theme engine code"
```

---

## Summary

| Task | What                    | Files                                                           |
| ---- | ----------------------- | --------------------------------------------------------------- |
| 1    | Theme type definitions  | `packages/contracts/src/theme.ts`                               |
| 2    | Base theme defaults     | `apps/web/src/theme/defaults.ts`                                |
| 3    | Theme merge/resolution  | `apps/web/src/theme/engine.ts`                                  |
| 4    | CSS applicator          | `apps/web/src/theme/applicator.ts`                              |
| 5    | Terminal theme mapper   | `apps/web/src/theme/terminal-mapper.ts`                         |
| 6    | Theme store             | `apps/web/src/theme/store.ts`                                   |
| 7    | Rewrite useTheme hook   | `apps/web/src/hooks/useTheme.ts`, `apps/web/src/theme/index.ts` |
| 8    | Slider + ColorPicker UI | `apps/web/src/components/ui/slider.tsx`, `color-picker.tsx`     |
| 9    | Appearance route        | `apps/web/src/routes/settings.appearance.tsx`                   |
| 10   | Editor header + tabs    | `ThemeEditorHeader.tsx`, `ThemeEditorTabs.tsx`                  |
| 11   | Colors panel            | `ColorsPanel.tsx`, `ColorTokenRow.tsx`, `colorSections.ts`      |
| 12   | Wire terminal consumer  | `ThreadTerminalDrawer.tsx`                                      |
| 13   | Wire composer consumer  | `ComposerPromptEditor.tsx`                                      |
| 14   | Remove old theme UI     | `SettingsPanels.tsx`                                            |
| 15   | Integration tests       | `apps/web/src/theme/integration.test.ts`                        |
| 16   | Lint + build            | All files                                                       |
