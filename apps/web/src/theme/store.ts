// apps/web/src/theme/store.ts
import type { Theme, ResolvedTheme, ThemeBase, ColorTokens, TypographyTokens, TransparencyTokens } from "@t3tools/contracts";
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
  /** The active base: "light" | "dark" (resolved from preference). */
  readonly base: ThemeBase;
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
    const activeCustom = activeId
      ? this.savedThemes.find((t) => t.id === activeId)
      : undefined;

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
      base: theme.base,
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

  setTypographyToken(tokenName: keyof TypographyTokens, value: string): void {
    const theme = structuredClone(this.snapshot.theme);
    if (!theme.overrides.typography) {
      theme.overrides.typography = {};
    }
    (theme.overrides.typography as Record<string, string>)[tokenName] = value;
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  resetTypographyToken(tokenName: keyof TypographyTokens): void {
    const theme = structuredClone(this.snapshot.theme);
    if (theme.overrides.typography) {
      delete (theme.overrides.typography as Record<string, string | undefined>)[tokenName];
    }
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  isTypographyTokenOverridden(tokenName: keyof TypographyTokens): boolean {
    const typography = this.snapshot.theme.overrides.typography;
    if (!typography) return false;
    return (typography as Record<string, unknown>)[tokenName] !== undefined;
  }

  setTransparencyToken(tokenName: keyof TransparencyTokens, value: number | string): void {
    const theme = structuredClone(this.snapshot.theme);
    if (!theme.overrides.transparency) {
      theme.overrides.transparency = {};
    }
    if (tokenName === "windowOpacity") {
      (theme.overrides.transparency as Record<string, number>)[tokenName] =
        Math.max(0.5, Math.min(1.0, Number(value)));
    } else if (tokenName === "vibrancy") {
      if (value === "auto" || value === "none") {
        (theme.overrides.transparency as Record<string, string>)[tokenName] = value;
      }
    }
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  resetTransparencyToken(tokenName: keyof TransparencyTokens): void {
    const theme = structuredClone(this.snapshot.theme);
    if (theme.overrides.transparency) {
      delete (theme.overrides.transparency as Record<string, unknown>)[tokenName];
    }
    theme.metadata.updatedAt = new Date().toISOString();
    this.update(theme, true);
    this.schedulePersist();
  }

  isTransparencyTokenOverridden(tokenName: keyof TransparencyTokens): boolean {
    const transparency = this.snapshot.theme.overrides.transparency;
    if (!transparency) return false;
    return (transparency as Record<string, unknown>)[tokenName] !== undefined;
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
