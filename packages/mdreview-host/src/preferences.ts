import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type StorageAdapter as CoreStorageAdapter,
  type ThemeName,
} from "@mdreview/core";

export const MDREVIEW_PREFERENCES_CHANGED_EVENT = "t3code:mdreview-preferences-changed";

const THEME_NAMES = new Set<string>([
  "github-light",
  "github-dark",
  "catppuccin-latte",
  "catppuccin-frappe",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "monokai",
  "monokai-pro",
  "one-dark-pro",
]);

const LOG_LEVELS = new Set(["none", "error", "warn", "info", "debug"]);
const TOC_POSITIONS = new Set(["left", "right"]);
const EXPORT_FORMATS = new Set(["docx", "pdf"]);
const ICON_THEMES = new Set([
  "lucide",
  "codicons",
  "symbols",
  "one-dark",
  "material",
  "catppuccin",
  "seti",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumberInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : undefined;
}

function optionalEnum<T extends string>(value: unknown, allowed: Set<string>): T | undefined {
  return typeof value === "string" && allowed.has(value) ? (value as T) : undefined;
}

function setOptionalPreference<K extends keyof Preferences>(
  preferences: Preferences,
  key: K,
  value: Preferences[K] | undefined,
): void {
  if (value !== undefined) {
    (preferences as Record<string, unknown>)[key] = value;
  }
}

/**
 * MD Review stores preferences as an untyped JSON object. Normalize that object
 * at the package boundary so renderers and settings panels never receive
 * malformed localStorage state.
 */
export function normalizeMdreviewPreferences(input: unknown): Preferences {
  const source = isRecord(input) ? input : {};
  const preferences: Preferences = { ...DEFAULT_PREFERENCES };

  preferences.theme = optionalEnum<ThemeName>(source.theme, THEME_NAMES) ?? preferences.theme;
  preferences.autoTheme = optionalBoolean(source.autoTheme) ?? preferences.autoTheme;
  preferences.lightTheme =
    optionalEnum<ThemeName>(source.lightTheme, THEME_NAMES) ?? preferences.lightTheme;
  preferences.darkTheme =
    optionalEnum<ThemeName>(source.darkTheme, THEME_NAMES) ?? preferences.darkTheme;
  preferences.syntaxTheme = optionalString(source.syntaxTheme) ?? preferences.syntaxTheme;
  preferences.autoReload = optionalBoolean(source.autoReload) ?? preferences.autoReload;
  preferences.lineNumbers = optionalBoolean(source.lineNumbers) ?? preferences.lineNumbers;
  preferences.enableHtml = optionalBoolean(source.enableHtml) ?? preferences.enableHtml;
  preferences.syncTabs = optionalBoolean(source.syncTabs) ?? preferences.syncTabs;
  preferences.logLevel = optionalEnum(source.logLevel, LOG_LEVELS) ?? preferences.logLevel;
  setOptionalPreference(preferences, "debug", optionalBoolean(source.debug));

  setOptionalPreference(preferences, "fontFamily", optionalString(source.fontFamily));
  setOptionalPreference(preferences, "codeFontFamily", optionalString(source.codeFontFamily));
  setOptionalPreference(preferences, "lineHeight", optionalNumberInRange(source.lineHeight, 1, 3));
  setOptionalPreference(preferences, "maxWidth", optionalNumberInRange(source.maxWidth, 320, 2400));
  setOptionalPreference(preferences, "useMaxWidth", optionalBoolean(source.useMaxWidth));

  preferences.showToc = optionalBoolean(source.showToc) ?? false;
  preferences.tocMaxDepth = optionalNumberInRange(source.tocMaxDepth, 1, 6) ?? 6;
  preferences.tocAutoCollapse = optionalBoolean(source.tocAutoCollapse) ?? false;
  preferences.tocPosition = optionalEnum(source.tocPosition, TOC_POSITIONS) ?? "left";

  preferences.commentsEnabled = optionalBoolean(source.commentsEnabled) ?? true;
  preferences.commentAuthor = optionalString(source.commentAuthor) ?? "";

  setOptionalPreference(
    preferences,
    "exportDefaultFormat",
    optionalEnum(source.exportDefaultFormat, EXPORT_FORMATS),
  );
  setOptionalPreference(
    preferences,
    "exportDefaultPageSize",
    optionalString(source.exportDefaultPageSize) as
      | Preferences["exportDefaultPageSize"]
      | undefined,
  );
  setOptionalPreference(preferences, "exportIncludeToc", optionalBoolean(source.exportIncludeToc));
  setOptionalPreference(
    preferences,
    "exportFilenameTemplate",
    optionalString(source.exportFilenameTemplate),
  );

  preferences.blockedSites = optionalStringArray(source.blockedSites) ?? [];
  preferences.showAllFiles = optionalBoolean(source.showAllFiles) ?? false;
  preferences.iconTheme = optionalEnum(source.iconTheme, ICON_THEMES) ?? "lucide";

  return preferences;
}

export async function readMdreviewPreferences(storage: CoreStorageAdapter): Promise<Preferences> {
  const stored = await storage.getSync("preferences");
  return normalizeMdreviewPreferences(stored.preferences);
}

export async function writeMdreviewPreferences(
  storage: CoreStorageAdapter,
  preferences: Preferences,
): Promise<void> {
  await storage.setSync({ preferences: normalizeMdreviewPreferences(preferences) });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MDREVIEW_PREFERENCES_CHANGED_EVENT));
  }
}
