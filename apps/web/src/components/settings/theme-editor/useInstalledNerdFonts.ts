import { useEffect, useState } from "react";

import type { FontPreset } from "./FontFamilySelect";

/**
 * Shape of a FontData entry returned by the Local Font Access API
 * (`window.queryLocalFonts()`). Typed inline because
 * `@types/dom-local-font-access` isn't part of the project's TS lib set.
 */
interface BrowserFontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: {
      postscriptNames?: readonly string[];
    }) => Promise<BrowserFontData[]>;
  }
}

export type InstalledNerdFontsStatus = "loading" | "ready" | "unsupported" | "denied" | "error";

export interface InstalledNerdFontsState {
  readonly status: InstalledNerdFontsStatus;
  readonly fonts: readonly FontPreset[];
  readonly error?: string;
}

const NERD_FONT_PATTERN = /nerd\s*font/i;

/**
 * Prefer the "Nerd Font Mono" variant of each base family when present —
 * those use single-width glyph metrics, which look correct in the
 * terminal's cell grid. The plain "Nerd Font" variants use proportional
 * metrics and can render glyphs double-wide.
 */
function rankVariant(family: string): number {
  if (/nerd\s*font\s*mono/i.test(family)) return 0;
  if (/nerd\s*font\s*propo/i.test(family)) return 2;
  return 1;
}

function deriveBaseName(family: string): string {
  // "JetBrainsMono Nerd Font Mono" → "JetBrainsMono"
  // "Hack Nerd Font" → "Hack"
  return family.replace(/\s*nerd\s*font(\s*mono|\s*propo)?\s*$/i, "").trim();
}

function toPreset(family: string): FontPreset {
  // Wrap in quotes if the family name contains whitespace or special
  // characters, and add a safe monospace fallback.
  const needsQuotes = /[\s"']/.test(family);
  const quoted = needsQuotes ? `"${family.replace(/"/g, '\\"')}"` : family;
  return {
    label: family,
    value: `${quoted}, ui-monospace, monospace`,
  };
}

/**
 * Queries the system font library via the Local Font Access API and
 * returns the subset of installed Nerd Fonts as `FontPreset` entries,
 * ready to drop into a `FontFamilySelect`.
 *
 * When multiple variants of the same base family are installed (e.g.
 * "JetBrainsMono Nerd Font" and "JetBrainsMono Nerd Font Mono"), only
 * the best terminal variant (Mono > regular > Propo) is surfaced so the
 * dropdown doesn't flood with near-duplicates.
 *
 * The hook handles three non-happy states:
 *  - `unsupported`: browser lacks `queryLocalFonts` (e.g. Firefox).
 *  - `denied`: user / Electron permission handler rejected the request.
 *  - `error`: any other failure (reported via `error` for diagnostics).
 */
export function useInstalledNerdFonts(): InstalledNerdFontsState {
  const [state, setState] = useState<InstalledNerdFontsState>({
    status: "loading",
    fonts: [],
  });

  useEffect(() => {
    let cancelled = false;

    const queryFn = typeof window === "undefined" ? undefined : window.queryLocalFonts;
    if (!queryFn) {
      setState({ status: "unsupported", fonts: [] });
      return;
    }

    void (async () => {
      try {
        const allFonts = await queryFn();
        if (cancelled) return;

        const nerdFamilies = new Set<string>();
        for (const font of allFonts) {
          if (NERD_FONT_PATTERN.test(font.family)) {
            nerdFamilies.add(font.family);
          }
        }

        // Group by base name, picking the best variant per group.
        const byBase = new Map<string, string>();
        for (const family of nerdFamilies) {
          const base = deriveBaseName(family) || family;
          const current = byBase.get(base);
          if (current === undefined || rankVariant(family) < rankVariant(current)) {
            byBase.set(base, family);
          }
        }

        const presets = Array.from(byBase.values())
          .sort((a, b) => a.localeCompare(b))
          .map(toPreset);

        setState({ status: "ready", fonts: presets });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        const isDenied =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "SecurityError");
        setState({
          status: isDenied ? "denied" : "error",
          fonts: [],
          error: message,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
