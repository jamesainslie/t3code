import { registerCustomTheme, resolveTheme } from "@pierre/diffs";
import type { SyntaxTheme } from "@t3tools/contracts";

type Appearance = "light" | "dark";
type CustomSyntaxTheme = Exclude<SyntaxTheme, "pierre">;

export type SyntaxThemeName = `pierre-${Appearance}` | `t3-${CustomSyntaxTheme}-${Appearance}`;

/**
 * Code surfaces paint their own background from the app palette, so these only
 * anchor contrast checks and the theme's fallback background.
 */
export const SYNTAX_THEME_CODE_BACKGROUNDS: Record<Appearance, string> = {
  dark: "#101010",
  light: "#fefefe",
};

/** Converts an OKLCH color to sRGB hex, so palettes can hold lightness and chroma steady. */
function oklch(lightness: number, chroma = 0, hue = 0): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const encoded = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, encoded)) * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

type FontStyle = "italic" | "bold";
type RoleStyle = string | { readonly color: string; readonly fontStyle: FontStyle };

const italic = (color: string): RoleStyle => ({ color, fontStyle: "italic" });
const bold = (color: string): RoleStyle => ({ color, fontStyle: "bold" });

/** TextMate scopes each palette role colors. Later, more specific selectors win by specificity. */
const ROLE_SCOPES = {
  comment: ["comment", "punctuation.definition.comment"],
  keyword: [
    "keyword",
    "storage",
    "storage.type",
    "storage.modifier",
    "keyword.control",
    "keyword.operator.new",
    "keyword.operator.expression",
    "keyword.operator.ternary",
  ],
  operator: [
    "keyword.operator",
    "keyword.operator.assignment",
    "keyword.operator.arithmetic",
    "keyword.operator.relational",
    "keyword.operator.comparison",
    "keyword.operator.logical",
    "keyword.operator.optional",
    "keyword.operator.spread",
  ],
  punctuation: [
    "punctuation",
    "meta.brace",
    "punctuation.separator",
    "punctuation.terminator",
    "punctuation.accessor",
    "meta.delimiter",
    "punctuation.definition.block",
    "punctuation.definition.parameters",
    "punctuation.definition.binding-pattern",
  ],
  templateExpr: ["punctuation.definition.template-expression", "punctuation.section.embedded"],
  string: ["string", "punctuation.definition.string", "string.template", "string.quoted"],
  escape: ["constant.character.escape"],
  number: [
    "constant.numeric",
    "constant.language",
    "constant.language.boolean",
    "constant.language.null",
    "constant.language.undefined",
  ],
  function: ["entity.name.function", "support.function", "meta.function-call entity.name.function"],
  functionDef: [
    "meta.definition.function entity.name.function",
    "meta.definition.method entity.name.function",
    "meta.definition.variable entity.name.function",
  ],
  type: [
    "entity.name.type",
    "support.type",
    "support.type.primitive",
    "entity.name.class",
    "support.class",
    "entity.other.inherited-class",
  ],
  typeDef: [
    "meta.interface entity.name.type.interface",
    "meta.type.declaration entity.name.type.alias",
    "meta.class entity.name.type.class",
  ],
  property: [
    "variable.other.property",
    "variable.other.object.property",
    "meta.object-literal.key",
    "support.variable.property",
    "variable.other.constant.property",
  ],
  variable: [
    "variable",
    "variable.other.readwrite",
    "variable.other.object",
    "meta.definition.variable",
  ],
  constant: ["variable.other.constant"],
  varDef: [
    "meta.definition.variable variable.other.constant",
    "meta.definition.variable variable.other.readwrite",
  ],
  param: ["variable.parameter"],
  tag: ["entity.name.tag", "support.class.component"],
  tagPunct: ["punctuation.definition.tag"],
  attribute: ["entity.other.attribute-name"],
  this: ["variable.language"],
  regexp: ["string.regexp"],
} as const;

type Role = keyof typeof ROLE_SCOPES;
type Palette = { readonly fg: string } & Partial<Record<Role, RoleStyle>>;

/** A role a palette leaves out borrows the color of the role it falls back to. */
const ROLE_FALLBACK: Partial<Record<Role | "fg", Role | "fg">> = {
  functionDef: "function",
  typeDef: "type",
  varDef: "constant",
  constant: "variable",
  param: "variable",
  property: "variable",
  variable: "fg",
  attribute: "property",
  tag: "type",
  tagPunct: "punctuation",
  this: "keyword",
  escape: "string",
  regexp: "string",
  templateExpr: "keyword",
  operator: "punctuation",
  function: "fg",
  type: "fg",
  keyword: "fg",
  punctuation: "fg",
  string: "fg",
  number: "fg",
  comment: "fg",
};

function roleStyle(palette: Palette, role: Role | "fg"): { color: string; fontStyle: string } {
  let current: Role | "fg" | undefined = role;
  while (current !== undefined && current !== "fg" && palette[current] === undefined) {
    current = ROLE_FALLBACK[current];
  }
  const style = current === undefined || current === "fg" ? palette.fg : palette[current]!;
  return typeof style === "string"
    ? { color: style, fontStyle: "" }
    : { color: style.color, fontStyle: style.fontStyle };
}

interface SyntaxThemeDefinition {
  readonly label: string;
  readonly description: string;
  readonly dark: Palette;
  readonly light: Palette;
}

const gray = (lightness: number) => oklch(lightness);

/** Graphite's quiet grayscale scaffold, shared by the single-accent themes. */
const GRAPHITE_DARK = {
  fg: gray(0.86),
  keyword: gray(0.64),
  operator: gray(0.6),
  punctuation: gray(0.5),
  comment: italic(gray(0.5)),
  string: gray(0.74),
  number: gray(0.74),
  function: gray(0.97),
  type: gray(0.8),
  property: gray(0.84),
  attribute: gray(0.64),
  tag: gray(0.8),
} satisfies Palette;

const GRAPHITE_LIGHT = {
  fg: gray(0.32),
  keyword: gray(0.55),
  operator: gray(0.55),
  punctuation: gray(0.64),
  comment: italic(gray(0.64)),
  string: gray(0.46),
  number: gray(0.46),
  function: gray(0.14),
  type: gray(0.38),
  property: gray(0.3),
  attribute: gray(0.55),
  tag: gray(0.38),
} satisfies Palette;

const SYNTAX_THEMES: Record<CustomSyntaxTheme, SyntaxThemeDefinition> = {
  graphite: {
    label: "Graphite",
    description: "No hue. Structure from lightness alone.",
    dark: GRAPHITE_DARK,
    light: GRAPHITE_LIGHT,
  },
  typeset: {
    label: "Typeset",
    description: "One ink. Weight and italics stand in for color.",
    dark: {
      fg: gray(0.88),
      keyword: bold(gray(0.88)),
      operator: gray(0.68),
      punctuation: gray(0.56),
      comment: italic(gray(0.54)),
      string: gray(0.74),
      number: gray(0.88),
      function: gray(0.92),
      functionDef: bold(gray(0.98)),
      type: italic(gray(0.88)),
      attribute: italic(gray(0.72)),
      tag: gray(0.88),
      templateExpr: gray(0.56),
    },
    light: {
      fg: gray(0.28),
      keyword: bold(gray(0.2)),
      operator: gray(0.5),
      punctuation: gray(0.6),
      comment: italic(gray(0.6)),
      string: gray(0.46),
      number: gray(0.28),
      function: gray(0.22),
      functionDef: bold(gray(0.12)),
      type: italic(gray(0.28)),
      attribute: italic(gray(0.48)),
      tag: gray(0.28),
      templateExpr: gray(0.6),
    },
  },
  ink: {
    label: "Ink",
    description: "Grayscale with indigo literals.",
    dark: { ...GRAPHITE_DARK, string: oklch(0.78, 0.085, 270), number: oklch(0.78, 0.085, 270) },
    light: { ...GRAPHITE_LIGHT, string: oklch(0.5, 0.15, 270), number: oklch(0.5, 0.15, 270) },
  },
  "four-kinds": {
    label: "Four Kinds",
    description: "Only strings, constants, comments and definitions.",
    dark: {
      fg: gray(0.88),
      punctuation: gray(0.6),
      operator: gray(0.74),
      comment: oklch(0.84, 0.085, 100),
      string: oklch(0.8, 0.09, 145),
      number: oklch(0.76, 0.09, 330),
      varDef: oklch(0.76, 0.09, 245),
      constant: gray(0.88),
      functionDef: oklch(0.76, 0.09, 245),
      typeDef: oklch(0.76, 0.09, 245),
      templateExpr: gray(0.6),
    },
    light: {
      fg: gray(0.25),
      punctuation: gray(0.55),
      operator: gray(0.4),
      comment: oklch(0.52, 0.1, 80),
      string: oklch(0.48, 0.12, 145),
      number: oklch(0.5, 0.15, 330),
      varDef: oklch(0.48, 0.14, 250),
      constant: gray(0.25),
      functionDef: oklch(0.48, 0.14, 250),
      typeDef: oklch(0.48, 0.14, 250),
      templateExpr: gray(0.55),
    },
  },
  dusk: {
    label: "Dusk",
    description: "A full spectrum at equal, low chroma.",
    dark: {
      fg: oklch(0.89, 0.005, 260),
      keyword: oklch(0.76, 0.06, 305),
      operator: oklch(0.7, 0.03, 260),
      punctuation: oklch(0.58, 0.01, 260),
      comment: italic(oklch(0.54, 0.015, 260)),
      string: oklch(0.8, 0.06, 145),
      number: oklch(0.8, 0.065, 55),
      function: oklch(0.82, 0.055, 235),
      type: oklch(0.82, 0.055, 190),
      property: oklch(0.86, 0.015, 260),
      tag: oklch(0.8, 0.06, 20),
      attribute: oklch(0.8, 0.055, 75),
    },
    light: {
      fg: oklch(0.3, 0.01, 260),
      keyword: oklch(0.48, 0.11, 305),
      operator: oklch(0.5, 0.03, 260),
      punctuation: oklch(0.6, 0.01, 260),
      comment: italic(oklch(0.62, 0.02, 260)),
      string: oklch(0.5, 0.1, 145),
      number: oklch(0.52, 0.11, 55),
      function: oklch(0.48, 0.1, 240),
      type: oklch(0.5, 0.08, 195),
      property: oklch(0.36, 0.02, 260),
      tag: oklch(0.5, 0.11, 20),
      attribute: oklch(0.52, 0.09, 75),
    },
  },
  frost: {
    label: "Frost",
    description: "Cool blues, teals and periwinkle.",
    dark: {
      fg: oklch(0.9, 0.01, 240),
      keyword: oklch(0.72, 0.07, 262),
      operator: oklch(0.68, 0.04, 240),
      punctuation: oklch(0.56, 0.02, 240),
      comment: italic(oklch(0.54, 0.025, 245)),
      string: oklch(0.82, 0.06, 175),
      number: oklch(0.8, 0.065, 290),
      function: oklch(0.86, 0.055, 215),
      type: oklch(0.82, 0.06, 195),
      property: oklch(0.88, 0.02, 230),
      tag: oklch(0.78, 0.07, 250),
      attribute: oklch(0.8, 0.05, 200),
    },
    light: {
      fg: oklch(0.3, 0.02, 245),
      keyword: oklch(0.47, 0.12, 262),
      operator: oklch(0.5, 0.04, 240),
      punctuation: oklch(0.6, 0.02, 240),
      comment: italic(oklch(0.62, 0.03, 245)),
      string: oklch(0.5, 0.09, 180),
      number: oklch(0.5, 0.12, 295),
      function: oklch(0.46, 0.1, 225),
      type: oklch(0.48, 0.08, 200),
      property: oklch(0.34, 0.03, 240),
      tag: oklch(0.47, 0.11, 255),
      attribute: oklch(0.5, 0.07, 205),
    },
  },
  paper: {
    label: "Paper",
    description: "Warm clay, olive, sand and amber.",
    dark: {
      fg: oklch(0.9, 0.012, 80),
      keyword: oklch(0.72, 0.075, 40),
      operator: oklch(0.68, 0.03, 70),
      punctuation: oklch(0.56, 0.015, 70),
      comment: italic(oklch(0.56, 0.025, 75)),
      string: oklch(0.8, 0.07, 110),
      number: oklch(0.8, 0.085, 65),
      function: oklch(0.88, 0.05, 85),
      type: oklch(0.78, 0.06, 15),
      property: oklch(0.86, 0.02, 75),
      tag: oklch(0.74, 0.07, 35),
      attribute: oklch(0.8, 0.06, 90),
    },
    light: {
      fg: oklch(0.3, 0.02, 60),
      keyword: oklch(0.5, 0.12, 38),
      operator: oklch(0.5, 0.03, 60),
      punctuation: oklch(0.6, 0.02, 60),
      comment: italic(oklch(0.6, 0.03, 70)),
      string: oklch(0.5, 0.1, 115),
      number: oklch(0.54, 0.12, 62),
      function: oklch(0.4, 0.07, 70),
      type: oklch(0.48, 0.1, 15),
      property: oklch(0.36, 0.02, 60),
      tag: oklch(0.5, 0.11, 35),
      attribute: oklch(0.52, 0.09, 90),
    },
  },
  duotone: {
    label: "Duotone",
    description: "Code in violet, data in gold.",
    dark: {
      fg: oklch(0.88, 0.02, 290),
      keyword: oklch(0.66, 0.08, 290),
      operator: oklch(0.62, 0.04, 290),
      punctuation: oklch(0.52, 0.02, 290),
      comment: italic(oklch(0.5, 0.02, 290)),
      string: oklch(0.84, 0.08, 85),
      number: oklch(0.8, 0.1, 75),
      function: oklch(0.94, 0.04, 290),
      type: oklch(0.78, 0.09, 290),
      property: oklch(0.86, 0.03, 290),
      tag: oklch(0.76, 0.09, 290),
      attribute: oklch(0.7, 0.06, 290),
    },
    light: {
      fg: oklch(0.3, 0.03, 290),
      keyword: oklch(0.52, 0.13, 290),
      operator: oklch(0.52, 0.05, 290),
      punctuation: oklch(0.62, 0.03, 290),
      comment: italic(oklch(0.62, 0.03, 290)),
      string: oklch(0.56, 0.11, 75),
      number: oklch(0.55, 0.12, 65),
      function: oklch(0.24, 0.06, 290),
      type: oklch(0.45, 0.14, 290),
      property: oklch(0.34, 0.04, 290),
      tag: oklch(0.45, 0.14, 290),
      attribute: oklch(0.52, 0.1, 290),
    },
  },
  "primer-hush": {
    label: "Primer Hush",
    description: "GitHub's familiar colors, turned down.",
    dark: {
      fg: gray(0.9),
      keyword: oklch(0.74, 0.1, 25),
      operator: gray(0.72),
      punctuation: gray(0.58),
      comment: italic(oklch(0.56, 0.01, 250)),
      string: oklch(0.83, 0.055, 240),
      number: oklch(0.78, 0.075, 245),
      constant: oklch(0.78, 0.075, 245),
      function: oklch(0.8, 0.075, 300),
      type: oklch(0.8, 0.075, 60),
      property: gray(0.9),
      tag: oklch(0.82, 0.08, 150),
      attribute: oklch(0.78, 0.075, 245),
      this: oklch(0.78, 0.075, 245),
    },
    light: {
      fg: gray(0.28),
      keyword: oklch(0.52, 0.15, 25),
      operator: gray(0.45),
      punctuation: gray(0.55),
      comment: italic(oklch(0.58, 0.02, 250)),
      string: oklch(0.4, 0.1, 250),
      number: oklch(0.48, 0.13, 250),
      constant: oklch(0.48, 0.13, 250),
      function: oklch(0.48, 0.15, 300),
      type: oklch(0.55, 0.13, 55),
      property: gray(0.28),
      tag: oklch(0.48, 0.13, 150),
      attribute: oklch(0.48, 0.13, 250),
      this: oklch(0.48, 0.13, 250),
    },
  },
  "pierre-hush": {
    label: "Pierre Hush",
    description: "Today's Pierre hues at 40% strength.",
    dark: {
      fg: gray(0.9),
      keyword: oklch(0.74, 0.085, 8),
      operator: gray(0.66),
      punctuation: gray(0.55),
      comment: gray(0.55),
      string: oklch(0.8, 0.075, 148),
      number: oklch(0.8, 0.06, 225),
      constant: oklch(0.86, 0.06, 90),
      function: oklch(0.78, 0.08, 295),
      type: oklch(0.8, 0.075, 320),
      property: gray(0.9),
      tag: oklch(0.74, 0.085, 8),
      attribute: oklch(0.8, 0.065, 165),
      this: oklch(0.82, 0.07, 70),
    },
    light: {
      fg: gray(0.27),
      keyword: oklch(0.52, 0.14, 8),
      operator: gray(0.5),
      punctuation: gray(0.6),
      comment: gray(0.58),
      string: oklch(0.5, 0.11, 148),
      number: oklch(0.52, 0.09, 225),
      constant: oklch(0.55, 0.1, 85),
      function: oklch(0.48, 0.14, 295),
      type: oklch(0.5, 0.13, 320),
      property: gray(0.27),
      tag: oklch(0.52, 0.14, 8),
      attribute: oklch(0.5, 0.09, 165),
      this: oklch(0.55, 0.1, 70),
    },
  },
  sumi: {
    label: "Sumi",
    description: "Grayscale with muted vermilion keywords.",
    dark: { ...GRAPHITE_DARK, keyword: oklch(0.7, 0.1, 32), tag: oklch(0.7, 0.1, 32) },
    light: { ...GRAPHITE_LIGHT, keyword: oklch(0.52, 0.15, 32), tag: oklch(0.52, 0.15, 32) },
  },
  sage: {
    label: "Sage",
    description: "Soft greens and teals.",
    dark: {
      fg: oklch(0.9, 0.01, 150),
      keyword: oklch(0.72, 0.06, 160),
      operator: oklch(0.66, 0.03, 150),
      punctuation: oklch(0.55, 0.015, 150),
      comment: italic(oklch(0.54, 0.02, 150)),
      string: oklch(0.82, 0.07, 125),
      number: oklch(0.8, 0.06, 185),
      function: oklch(0.88, 0.045, 140),
      type: oklch(0.8, 0.06, 175),
      property: oklch(0.87, 0.02, 150),
      tag: oklch(0.75, 0.07, 160),
      attribute: oklch(0.8, 0.05, 130),
    },
    light: {
      fg: oklch(0.3, 0.02, 150),
      keyword: oklch(0.46, 0.1, 160),
      operator: oklch(0.5, 0.03, 150),
      punctuation: oklch(0.6, 0.02, 150),
      comment: italic(oklch(0.62, 0.03, 150)),
      string: oklch(0.48, 0.11, 125),
      number: oklch(0.48, 0.09, 190),
      function: oklch(0.36, 0.07, 145),
      type: oklch(0.46, 0.09, 180),
      property: oklch(0.34, 0.02, 150),
      tag: oklch(0.46, 0.1, 160),
      attribute: oklch(0.5, 0.08, 130),
    },
  },
  rose: {
    label: "Rosé",
    description: "Muted rose, pine, gold and iris.",
    dark: {
      fg: oklch(0.88, 0.015, 300),
      keyword: oklch(0.72, 0.06, 215),
      operator: oklch(0.66, 0.02, 300),
      punctuation: oklch(0.55, 0.015, 300),
      comment: italic(oklch(0.54, 0.02, 300)),
      string: oklch(0.82, 0.06, 75),
      number: oklch(0.78, 0.06, 20),
      function: oklch(0.8, 0.055, 10),
      type: oklch(0.82, 0.05, 200),
      property: oklch(0.82, 0.04, 300),
      tag: oklch(0.72, 0.06, 215),
      attribute: oklch(0.78, 0.05, 300),
    },
    light: {
      fg: oklch(0.32, 0.03, 300),
      keyword: oklch(0.48, 0.08, 215),
      operator: oklch(0.52, 0.02, 300),
      punctuation: oklch(0.62, 0.02, 300),
      comment: italic(oklch(0.62, 0.03, 300)),
      string: oklch(0.58, 0.11, 70),
      number: oklch(0.55, 0.11, 20),
      function: oklch(0.5, 0.12, 10),
      type: oklch(0.5, 0.08, 205),
      property: oklch(0.45, 0.08, 300),
      tag: oklch(0.48, 0.08, 215),
      attribute: oklch(0.48, 0.08, 300),
    },
  },
  lichen: {
    label: "Lichen",
    description: "Forest greens, aqua and ochre.",
    dark: {
      fg: oklch(0.86, 0.02, 90),
      keyword: oklch(0.74, 0.07, 25),
      operator: oklch(0.68, 0.03, 90),
      punctuation: oklch(0.56, 0.02, 90),
      comment: italic(oklch(0.56, 0.02, 100)),
      string: oklch(0.8, 0.06, 170),
      number: oklch(0.78, 0.06, 340),
      function: oklch(0.82, 0.07, 128),
      type: oklch(0.84, 0.07, 92),
      property: oklch(0.84, 0.02, 90),
      tag: oklch(0.76, 0.07, 55),
      attribute: oklch(0.82, 0.07, 92),
    },
    light: {
      fg: oklch(0.36, 0.03, 90),
      keyword: oklch(0.52, 0.12, 25),
      operator: oklch(0.52, 0.03, 90),
      punctuation: oklch(0.62, 0.03, 90),
      comment: italic(oklch(0.62, 0.03, 100)),
      string: oklch(0.52, 0.08, 175),
      number: oklch(0.52, 0.1, 340),
      function: oklch(0.5, 0.11, 128),
      type: oklch(0.55, 0.11, 85),
      property: oklch(0.38, 0.03, 90),
      tag: oklch(0.55, 0.12, 55),
      attribute: oklch(0.55, 0.11, 85),
    },
  },
  "mono-blue": {
    label: "Mono Blue",
    description: "One blue hue, varied by lightness.",
    dark: {
      fg: oklch(0.86, 0.02, 250),
      keyword: oklch(0.64, 0.05, 255),
      operator: oklch(0.6, 0.03, 250),
      punctuation: oklch(0.5, 0.02, 250),
      comment: italic(oklch(0.5, 0.02, 250)),
      string: oklch(0.8, 0.07, 240),
      number: oklch(0.8, 0.07, 240),
      function: oklch(0.96, 0.02, 250),
      type: oklch(0.78, 0.05, 250),
      property: oklch(0.84, 0.025, 250),
      attribute: oklch(0.64, 0.05, 255),
      tag: oklch(0.78, 0.05, 250),
    },
    light: {
      fg: oklch(0.32, 0.04, 255),
      keyword: oklch(0.54, 0.08, 258),
      operator: oklch(0.55, 0.04, 255),
      punctuation: oklch(0.64, 0.03, 255),
      comment: italic(oklch(0.64, 0.03, 255)),
      string: oklch(0.46, 0.12, 250),
      number: oklch(0.46, 0.12, 250),
      function: oklch(0.16, 0.04, 255),
      type: oklch(0.38, 0.07, 255),
      property: oklch(0.3, 0.04, 255),
      attribute: oklch(0.54, 0.08, 258),
      tag: oklch(0.38, 0.07, 255),
    },
  },
  "solarized-hush": {
    label: "Solarized Hush",
    description: "Solarized accents on a neutral surface.",
    dark: {
      fg: oklch(0.86, 0.012, 200),
      keyword: oklch(0.72, 0.08, 115),
      operator: oklch(0.66, 0.02, 200),
      punctuation: oklch(0.55, 0.015, 200),
      comment: italic(oklch(0.55, 0.02, 200)),
      string: oklch(0.76, 0.07, 185),
      number: oklch(0.74, 0.08, 350),
      function: oklch(0.74, 0.08, 245),
      type: oklch(0.78, 0.08, 85),
      property: oklch(0.84, 0.015, 200),
      tag: oklch(0.72, 0.08, 245),
      attribute: oklch(0.78, 0.08, 85),
      this: oklch(0.72, 0.08, 45),
    },
    light: {
      fg: oklch(0.36, 0.02, 220),
      keyword: oklch(0.52, 0.11, 115),
      operator: oklch(0.52, 0.02, 220),
      punctuation: oklch(0.62, 0.02, 220),
      comment: italic(oklch(0.62, 0.02, 200)),
      string: oklch(0.52, 0.09, 185),
      number: oklch(0.52, 0.13, 350),
      function: oklch(0.5, 0.12, 245),
      type: oklch(0.56, 0.11, 85),
      property: oklch(0.36, 0.02, 220),
      tag: oklch(0.5, 0.12, 245),
      attribute: oklch(0.56, 0.11, 85),
      this: oklch(0.55, 0.13, 45),
    },
  },
  "gruvbox-hush": {
    label: "Gruvbox Hush",
    description: "Retro warm tones, softened.",
    dark: {
      fg: oklch(0.88, 0.03, 85),
      keyword: oklch(0.7, 0.09, 32),
      operator: oklch(0.68, 0.03, 80),
      punctuation: oklch(0.56, 0.02, 80),
      comment: italic(oklch(0.56, 0.025, 80)),
      string: oklch(0.8, 0.08, 115),
      number: oklch(0.74, 0.07, 355),
      function: oklch(0.8, 0.06, 145),
      type: oklch(0.82, 0.08, 85),
      property: oklch(0.8, 0.04, 200),
      tag: oklch(0.72, 0.06, 200),
      attribute: oklch(0.8, 0.06, 145),
      this: oklch(0.74, 0.09, 55),
    },
    light: {
      fg: oklch(0.34, 0.03, 70),
      keyword: oklch(0.5, 0.13, 30),
      operator: oklch(0.5, 0.03, 70),
      punctuation: oklch(0.6, 0.03, 70),
      comment: italic(oklch(0.6, 0.03, 70)),
      string: oklch(0.5, 0.11, 115),
      number: oklch(0.5, 0.11, 355),
      function: oklch(0.48, 0.08, 150),
      type: oklch(0.56, 0.12, 80),
      property: oklch(0.44, 0.06, 210),
      tag: oklch(0.46, 0.07, 210),
      attribute: oklch(0.48, 0.08, 150),
      this: oklch(0.56, 0.13, 55),
    },
  },
  "kanagawa-hush": {
    label: "Kanagawa Hush",
    description: "Wave blues, spring green and sakura.",
    dark: {
      fg: oklch(0.88, 0.03, 95),
      keyword: oklch(0.66, 0.07, 295),
      operator: oklch(0.72, 0.06, 80),
      punctuation: oklch(0.58, 0.02, 90),
      comment: italic(oklch(0.55, 0.015, 95)),
      string: oklch(0.76, 0.08, 130),
      number: oklch(0.7, 0.08, 355),
      function: oklch(0.7, 0.07, 260),
      type: oklch(0.72, 0.05, 180),
      property: oklch(0.84, 0.05, 85),
      tag: oklch(0.7, 0.07, 260),
      attribute: oklch(0.76, 0.06, 85),
      this: oklch(0.74, 0.08, 55),
    },
    light: {
      fg: oklch(0.36, 0.03, 90),
      keyword: oklch(0.48, 0.1, 295),
      operator: oklch(0.52, 0.07, 80),
      punctuation: oklch(0.6, 0.02, 90),
      comment: italic(oklch(0.62, 0.02, 95)),
      string: oklch(0.5, 0.1, 130),
      number: oklch(0.52, 0.12, 355),
      function: oklch(0.48, 0.1, 260),
      type: oklch(0.5, 0.07, 180),
      property: oklch(0.52, 0.08, 80),
      tag: oklch(0.48, 0.1, 260),
      attribute: oklch(0.52, 0.08, 80),
      this: oklch(0.56, 0.12, 55),
    },
  },
  landmarks: {
    label: "Landmarks",
    description: "Only declarations are colored.",
    dark: {
      ...GRAPHITE_DARK,
      function: gray(0.86),
      constant: gray(0.86),
      varDef: oklch(0.8, 0.09, 265),
      functionDef: oklch(0.8, 0.09, 265),
      typeDef: oklch(0.8, 0.09, 265),
    },
    light: {
      ...GRAPHITE_LIGHT,
      function: gray(0.32),
      constant: gray(0.32),
      varDef: oklch(0.48, 0.15, 265),
      functionDef: oklch(0.48, 0.15, 265),
      typeDef: oklch(0.48, 0.15, 265),
    },
  },
  ember: {
    label: "Ember",
    description: "Grayscale with peach names and mint strings.",
    dark: {
      fg: gray(0.92),
      keyword: gray(0.66),
      operator: gray(0.62),
      punctuation: gray(0.55),
      comment: italic(gray(0.52)),
      string: oklch(0.86, 0.07, 175),
      number: oklch(0.86, 0.08, 65),
      function: oklch(0.86, 0.08, 65),
      type: oklch(0.86, 0.08, 65),
      property: gray(0.9),
      tag: oklch(0.86, 0.08, 65),
      attribute: gray(0.7),
    },
    light: {
      fg: gray(0.25),
      keyword: gray(0.55),
      operator: gray(0.55),
      punctuation: gray(0.62),
      comment: italic(gray(0.62)),
      string: oklch(0.52, 0.09, 175),
      number: oklch(0.58, 0.13, 55),
      function: oklch(0.56, 0.13, 55),
      type: oklch(0.56, 0.13, 55),
      property: gray(0.25),
      tag: oklch(0.56, 0.13, 55),
      attribute: gray(0.5),
    },
  },
};

/** Pierre's own token colors, for the picker's swatch strip. */
const PIERRE_SWATCHES: Record<Appearance, readonly string[]> = {
  dark: ["#ff678d", "#9d6afb", "#d568ea", "#5ecc71", "#68cdf2", "#737373"],
  light: ["#d32a61", "#693acf", "#a631be", "#199f43", "#1ca1c7", "#737373"],
};

const SWATCH_ROLES = ["keyword", "function", "type", "string", "number", "comment"] as const;

export const SYNTAX_THEME_OPTIONS: ReadonlyArray<{
  readonly id: SyntaxTheme;
  readonly label: string;
  readonly description: string;
}> = [
  { id: "pierre", label: "Pierre", description: "The default. Vivid and saturated." },
  ...(Object.keys(SYNTAX_THEMES) as CustomSyntaxTheme[]).map((id) => ({
    id,
    label: SYNTAX_THEMES[id].label,
    description: SYNTAX_THEMES[id].description,
  })),
];

export function isSyntaxTheme(value: unknown): value is SyntaxTheme {
  return SYNTAX_THEME_OPTIONS.some((option) => option.id === value);
}

/** Representative token colors for a theme, keyword first and comment last. */
export function syntaxThemeSwatches(
  theme: SyntaxTheme,
  appearance: Appearance,
): ReadonlyArray<{ readonly role: (typeof SWATCH_ROLES)[number]; readonly color: string }> {
  return SWATCH_ROLES.map((role, index) => ({
    role,
    color:
      theme === "pierre"
        ? PIERRE_SWATCHES[appearance][index]!
        : roleStyle(SYNTAX_THEMES[theme][appearance], role).color,
  }));
}

/** Builds the Shiki theme for one palette on top of Pierre's workbench colors (gutter, git, selection). */
export function buildSyntaxTheme(
  theme: CustomSyntaxTheme,
  appearance: Appearance,
  workbenchColors: Readonly<Record<string, string>>,
) {
  const palette = SYNTAX_THEMES[theme][appearance];
  const foreground = roleStyle(palette, "fg").color;
  return {
    name: `t3-${theme}-${appearance}` satisfies SyntaxThemeName,
    type: appearance,
    colors: {
      ...workbenchColors,
      "editor.background": SYNTAX_THEME_CODE_BACKGROUNDS[appearance],
      "editor.foreground": foreground,
    },
    tokenColors: (Object.keys(ROLE_SCOPES) as Role[]).map((role) => {
      const style = roleStyle(palette, role);
      return {
        scope: [...ROLE_SCOPES[role]],
        settings: { foreground: style.color, fontStyle: style.fontStyle },
      };
    }),
  };
}

const registeredThemeNames = new Set<SyntaxThemeName>();

/**
 * Names the Shiki theme for a syntax theme in the given appearance. Custom
 * themes register with Pierre on first use, so any name this returns can be
 * handed to a highlighter or worker pool.
 */
export function resolveSyntaxThemeName(
  appearance: Appearance,
  theme: SyntaxTheme,
): SyntaxThemeName {
  if (theme === "pierre") return `pierre-${appearance}`;
  const name: SyntaxThemeName = `t3-${theme}-${appearance}`;
  if (!registeredThemeNames.has(name)) {
    registeredThemeNames.add(name);
    registerCustomTheme(name, async () => {
      const pierre = await resolveTheme(`pierre-${appearance}`);
      return buildSyntaxTheme(theme, appearance, pierre.colors ?? {});
    });
  }
  return name;
}
