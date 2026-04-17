import type { ResolvedColorTokens, TypographyTokens } from "@t3tools/contracts";

/**
 * Converts a camelCase name to kebab-case.
 * e.g. "appChromeBackground" -> "app-chrome-background"
 */
function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

/**
 * Converts a camelCase token name to a --kebab-case CSS custom property.
 * e.g. "appChromeBackground" -> "--app-chrome-background"
 */
export function colorTokenToCssProperty(tokenName: string): string {
  return `--${camelToKebab(tokenName)}`;
}

/**
 * Converts a camelCase typography token name to a --kebab-case CSS custom property.
 * e.g. "uiFontFamily" -> "--ui-font-family"
 */
export function typographyTokenToCssProperty(tokenName: string): string {
  return `--${camelToKebab(tokenName)}`;
}

/** Keys in TypographyTokens that are metadata, not CSS custom properties. */
const TYPOGRAPHY_NON_CSS_KEYS = new Set(["customFontUrl"]);

/**
 * Builds a flat map of CSS custom property names to values
 * from a resolved typography tokens object, excluding non-CSS metadata keys.
 */
export function buildTypographyCssMap(tokens: Required<TypographyTokens>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    if (TYPOGRAPHY_NON_CSS_KEYS.has(key)) continue;
    if (value === undefined) continue;
    map[typographyTokenToCssProperty(key)] = value;
  }
  return map;
}

/**
 * Applies resolved typography tokens as CSS custom properties on a target element.
 */
export function applyTypographyCssTokens(
  element: HTMLElement,
  tokens: Required<TypographyTokens>,
): void {
  const map = buildTypographyCssMap(tokens);
  for (const [property, value] of Object.entries(map)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Clears all typography CSS custom properties from an element.
 */
export function clearTypographyCssTokens(
  element: HTMLElement,
  tokens: Required<TypographyTokens>,
): void {
  for (const key of Object.keys(tokens)) {
    if (TYPOGRAPHY_NON_CSS_KEYS.has(key)) continue;
    element.style.removeProperty(typographyTokenToCssProperty(key));
  }
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
 */
export function clearCssTokens(element: HTMLElement, tokens: ResolvedColorTokens): void {
  for (const key of Object.keys(tokens)) {
    element.style.removeProperty(colorTokenToCssProperty(key));
  }
}
