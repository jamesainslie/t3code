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
export function buildCssPropertyMap(
  tokens: ResolvedColorTokens,
): Record<string, string> {
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
export function applyCssTokens(
  element: HTMLElement,
  tokens: ResolvedColorTokens,
): void {
  const map = buildCssPropertyMap(tokens);
  for (const [property, value] of Object.entries(map)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Clears all theme-engine-applied CSS custom properties from an element.
 */
export function clearCssTokens(
  element: HTMLElement,
  tokens: ResolvedColorTokens,
): void {
  for (const key of Object.keys(tokens)) {
    element.style.removeProperty(colorTokenToCssProperty(key));
  }
}
