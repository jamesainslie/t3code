import type { SyntaxTheme } from "@t3tools/contracts";

import { useTheme } from "../hooks/useTheme";
import { syntaxThemeSwatches } from "../lib/syntaxThemes";

/** A theme's keyword-to-comment colors for the current light or dark mode. */
export function SyntaxThemeSwatches({ theme }: { theme: SyntaxTheme }) {
  const { resolvedTheme } = useTheme();
  return (
    <span aria-hidden="true" className="flex shrink-0 gap-0.5">
      {syntaxThemeSwatches(theme, resolvedTheme).map(({ role, color }) => (
        <span key={role} className="size-2 rounded-full" style={{ backgroundColor: color }} />
      ))}
    </span>
  );
}
