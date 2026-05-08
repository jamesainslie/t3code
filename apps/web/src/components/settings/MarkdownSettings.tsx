import { DEFAULT_PREFERENCES, ThemeEngine, type Preferences, type ThemeName } from "@mdreview/core";
import type { MarkdownPreferencesDocument } from "@t3tools/contracts";
import {
  T3StorageAdapter,
  normalizeMdreviewPreferences,
  readMdreviewPreferences,
  writeMdreviewPreferences,
} from "@t3tools/mdreview-host";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readLocalApi } from "~/localApi";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const themeEngine = new ThemeEngine();
const THEME_OPTIONS = themeEngine.getAvailableThemes();
const DEFAULT_MDREVIEW_PREFERENCES = normalizeMdreviewPreferences(DEFAULT_PREFERENCES);

const SYNTAX_THEME_OPTIONS = [
  { value: "github", label: "GitHub" },
  { value: "github-dark", label: "GitHub Dark" },
  { value: "monokai", label: "Monokai" },
  { value: "monokai-pro", label: "Monokai Pro" },
  { value: "one-dark-pro", label: "One Dark Pro" },
] as const;

const LOG_LEVEL_OPTIONS = [
  { value: "none", label: "None" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
] as const;

const ICON_THEME_OPTIONS = [
  { value: "lucide", label: "Lucide" },
  { value: "codicons", label: "Codicons" },
  { value: "symbols", label: "Symbols" },
  { value: "one-dark", label: "One Dark" },
  { value: "material", label: "Material" },
  { value: "catppuccin", label: "Catppuccin" },
  { value: "seti", label: "Seti" },
] as const;

function createBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return new T3StorageAdapter({ backing: window.localStorage });
}

function isThemeName(value: string): value is ThemeName {
  return THEME_OPTIONS.some((theme) => theme.name === value);
}

function themeLabel(themeName: ThemeName): string {
  return THEME_OPTIONS.find((theme) => theme.name === themeName)?.displayName ?? themeName;
}

function selectControl<T extends string>(props: {
  readonly value: T;
  readonly label: string;
  readonly className?: string;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value !== null) {
          props.onChange(value);
        }
      }}
    >
      <SelectTrigger className={props.className ?? "w-full sm:w-48"} aria-label={props.label}>
        <SelectValue>
          {props.options.find((option) => option.value === props.value)?.label}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem hideIndicator key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function themeSelectControl(props: {
  readonly value: ThemeName;
  readonly label: string;
  readonly onChange: (value: ThemeName) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value !== null && isThemeName(value)) {
          props.onChange(value);
        }
      }}
    >
      <SelectTrigger className="w-full sm:w-56" aria-label={props.label}>
        <SelectValue>{themeLabel(props.value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {THEME_OPTIONS.map((option) => (
          <SelectItem hideIndicator key={option.name} value={option.name}>
            {option.displayName}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

// Debounce window for the desktop-bridge mirror write. The localStorage write
// (via T3StorageAdapter) still happens synchronously per change so the
// renderer reflects updates immediately; only the IPC + temp+rename round-trip
// to the on-disk file is coalesced. 300ms matches the ThemeStore's
// `schedulePersist` cadence so both panels feel equally responsive.
const DESKTOP_PERSIST_DEBOUNCE_MS = 300;

export function MarkdownSettings() {
  const storage = useMemo(() => createBrowserStorage(), []);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_MDREVIEW_PREFERENCES);
  const [isSaving, setIsSaving] = useState(false);
  const desktopPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDesktopDoc = useRef<MarkdownPreferencesDocument | null>(null);

  // Cancel any pending desktop write on unmount. Without this, a fast
  // navigation away from the panel can leak a setTimeout that fires after
  // unmount and writes a stale document.
  useEffect(() => {
    return () => {
      if (desktopPersistTimer.current) {
        clearTimeout(desktopPersistTimer.current);
        desktopPersistTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!storage) return;
    let cancelled = false;

    // Sequence the two reads so the desktop bridge value (when present) is
    // the final authority. Running them in parallel would race: a slow
    // T3StorageAdapter read settling AFTER the bridge `setPreferences` would
    // overwrite the persisted document with stale localStorage state.
    //
    // We deliberately do NOT round-trip through localStorage with a
    // hand-rolled key during hydration. T3StorageAdapter namespaces under
    // `t3code:mdreview:<key>` (e.g. `t3code:mdreview:preferences`) and any
    // stand-in key would silently de-sync the renderer from the settings
    // panel. Instead, normalize the bridge document directly into local
    // state and let `writeMdreviewPreferences` mirror it back through the
    // adapter so other in-page consumers (the renderer, etc.) see the
    // hydrated value.
    void (async () => {
      try {
        const stored = await readMdreviewPreferences(storage);
        if (!cancelled) {
          setPreferences(stored);
        }
      } catch (error) {
        if (!cancelled) {
          toastManager.add({
            type: "error",
            title: "Could not load markdown settings",
            description:
              error instanceof Error ? error.message : "Stored MD Review settings failed to load.",
          });
        }
      }

      const api = readLocalApi();
      if (!api || cancelled) return;
      try {
        const persisted = await api.persistence.getMarkdownPreferences();
        if (cancelled || !persisted) return;
        const normalized = normalizeMdreviewPreferences(persisted);
        setPreferences(normalized);
        await writeMdreviewPreferences(storage, normalized);
      } catch {
        // Bridge unavailable / read failed — fall back to the localStorage
        // copy already applied above.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storage]);

  const persistPreferences = useCallback(
    (nextPreferences: Preferences) => {
      const normalized = normalizeMdreviewPreferences(nextPreferences);
      setPreferences(normalized);
      if (!storage) return;

      // Boundary cast: `Preferences` is owned by `@mdreview/core` and
      // structurally compatible with our storage document, but its
      // declaration evolves outside this repo. The
      // `MarkdownPreferencesDocument` schema is intentionally permissive
      // (`Schema.Record(string, unknown)`) so this single cast at the
      // panel-to-bridge boundary is the only place the two type universes
      // touch.
      const desktopDoc = normalized as unknown as MarkdownPreferencesDocument;

      // Always write the in-memory copy through the T3StorageAdapter so the
      // renderer (which reads the same namespaced key) sees changes
      // immediately. The desktop mirror is debounced separately below.
      setIsSaving(true);
      void writeMdreviewPreferences(storage, normalized)
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not save markdown settings",
            description:
              error instanceof Error ? error.message : "MD Review settings were not saved.",
          });
        })
        .finally(() => setIsSaving(false));

      // Coalesce free-text typing (commentAuthor, etc.) into a single
      // file-level write. Boolean toggles still feel instant because the
      // localStorage write above is synchronous; only the IPC + temp+rename
      // disk write is debounced.
      pendingDesktopDoc.current = desktopDoc;
      if (desktopPersistTimer.current) {
        clearTimeout(desktopPersistTimer.current);
      }
      desktopPersistTimer.current = setTimeout(() => {
        desktopPersistTimer.current = null;
        const docToPersist = pendingDesktopDoc.current;
        pendingDesktopDoc.current = null;
        if (!docToPersist) return;
        const api = readLocalApi();
        if (!api) return;
        void api.persistence.setMarkdownPreferences(docToPersist).catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not save markdown settings",
            description:
              error instanceof Error ? error.message : "MD Review settings were not persisted.",
          });
        });
      }, DESKTOP_PERSIST_DEBOUNCE_MS);
    },
    [storage],
  );

  const updatePreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      persistPreferences({ ...preferences, [key]: value });
    },
    [persistPreferences, preferences],
  );

  const restoreDefaults = useCallback(() => {
    persistPreferences(DEFAULT_MDREVIEW_PREFERENCES);
  }, [persistPreferences]);

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Markdown Renderer"
        headerAction={
          <Button size="xs" variant="outline" onClick={restoreDefaults} disabled={isSaving}>
            Restore MD Review defaults
          </Button>
        }
      >
        <SettingsRow
          title="Theme"
          description="Choose the MD Review theme used for markdown previews and file browser rendering."
          control={themeSelectControl({
            value: preferences.theme,
            label: "Markdown theme",
            onChange: (value) => updatePreference("theme", value),
          })}
        />

        <SettingsRow
          title="Automatic theme"
          description="Use the selected light and dark MD Review themes with the system appearance."
          control={
            <Switch
              checked={preferences.autoTheme}
              onCheckedChange={(checked) => updatePreference("autoTheme", Boolean(checked))}
              aria-label="Use automatic markdown theme"
            />
          }
        />

        <SettingsRow
          title="Light theme"
          description="Theme used when automatic theme follows a light appearance."
          control={themeSelectControl({
            value: preferences.lightTheme,
            label: "Markdown light theme",
            onChange: (value) => updatePreference("lightTheme", value),
          })}
        />

        <SettingsRow
          title="Dark theme"
          description="Theme used when automatic theme follows a dark appearance."
          control={themeSelectControl({
            value: preferences.darkTheme,
            label: "Markdown dark theme",
            onChange: (value) => updatePreference("darkTheme", value),
          })}
        />

        <SettingsRow
          title="Syntax theme"
          description="Code highlighting palette requested from MD Review."
          control={selectControl({
            value: preferences.syntaxTheme,
            label: "Markdown syntax theme",
            options: SYNTAX_THEME_OPTIONS,
            onChange: (value) => updatePreference("syntaxTheme", value),
          })}
        />
      </SettingsSection>

      <SettingsSection title="Rendering">
        <SettingsRow
          title="Code line numbers"
          description="Show line numbers inside fenced code blocks."
          control={
            <Switch
              checked={preferences.lineNumbers}
              onCheckedChange={(checked) => updatePreference("lineNumbers", Boolean(checked))}
              aria-label="Show markdown code line numbers"
            />
          }
        />

        <SettingsRow
          title="HTML rendering"
          description="Allow inline HTML in markdown files."
          control={
            <Switch
              checked={preferences.enableHtml}
              onCheckedChange={(checked) => updatePreference("enableHtml", Boolean(checked))}
              aria-label="Allow markdown HTML rendering"
            />
          }
        />

        <SettingsRow
          title="Full width"
          description="Let rendered markdown use all available preview width."
          control={
            <Switch
              checked={preferences.useMaxWidth ?? false}
              onCheckedChange={(checked) => updatePreference("useMaxWidth", Boolean(checked))}
              aria-label="Use full markdown width"
            />
          }
        />

        <SettingsRow
          title="Maximum width"
          description="Content width used when full width is off."
          control={
            <Input
              className="w-full sm:w-32"
              type="number"
              min={320}
              max={2400}
              value={preferences.maxWidth ?? 980}
              onChange={(event) =>
                updatePreference("maxWidth", Number(event.currentTarget.value) || undefined)
              }
              aria-label="Markdown maximum width"
            />
          }
        />

        <SettingsRow
          title="Line height"
          description="Base line height for markdown body text."
          control={
            <Input
              className="w-full sm:w-32"
              type="number"
              min={1}
              max={3}
              step={0.05}
              value={preferences.lineHeight ?? 1.5}
              onChange={(event) =>
                updatePreference("lineHeight", Number(event.currentTarget.value) || undefined)
              }
              aria-label="Markdown line height"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Navigation">
        <SettingsRow
          title="Table of contents"
          description="Enable MD Review table-of-contents handling for markdown documents."
          control={
            <Switch
              checked={preferences.showToc ?? false}
              onCheckedChange={(checked) => updatePreference("showToc", Boolean(checked))}
              aria-label="Enable markdown table of contents"
            />
          }
        />

        <SettingsRow
          title="TOC depth"
          description="Deepest heading level included in the markdown table of contents."
          control={selectControl({
            value: String(preferences.tocMaxDepth ?? 6),
            label: "Markdown table of contents depth",
            options: ["1", "2", "3", "4", "5", "6"].map((value) => ({
              value,
              label: `H${value}`,
            })),
            onChange: (value) => updatePreference("tocMaxDepth", Number(value)),
          })}
        />

        <SettingsRow
          title="TOC position"
          description="Side used by MD Review's table-of-contents overlay."
          control={selectControl({
            value: preferences.tocPosition ?? "left",
            label: "Markdown table of contents position",
            options: [
              { value: "left", label: "Left" },
              { value: "right", label: "Right" },
            ],
            onChange: (value) => {
              if (value === "left" || value === "right") {
                updatePreference("tocPosition", value);
              }
            },
          })}
        />

        <SettingsRow
          title="Auto-collapse TOC"
          description="Collapse nested table-of-contents branches by default."
          control={
            <Switch
              checked={preferences.tocAutoCollapse ?? false}
              onCheckedChange={(checked) => updatePreference("tocAutoCollapse", Boolean(checked))}
              aria-label="Auto-collapse markdown table of contents"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Comments and Files">
        <SettingsRow
          title="Comments"
          description="Allow MD Review comments in rendered markdown previews."
          control={
            <Switch
              checked={preferences.commentsEnabled ?? true}
              onCheckedChange={(checked) => updatePreference("commentsEnabled", Boolean(checked))}
              aria-label="Enable markdown comments"
            />
          }
        />

        <SettingsRow
          title="Comment author"
          description="Name written into new MD Review comments."
          control={
            <Input
              className="w-full sm:w-44"
              value={preferences.commentAuthor ?? ""}
              onChange={(event) => updatePreference("commentAuthor", event.currentTarget.value)}
              placeholder="T3"
              aria-label="Markdown comment author"
            />
          }
        />

        <SettingsRow
          title="Show all files"
          description="Include non-markdown files when MD Review file-tree features are used."
          control={
            <Switch
              checked={preferences.showAllFiles ?? false}
              onCheckedChange={(checked) => updatePreference("showAllFiles", Boolean(checked))}
              aria-label="Show all markdown file tree files"
            />
          }
        />

        <SettingsRow
          title="File icon theme"
          description="Icon set requested for MD Review file-tree rendering."
          control={selectControl({
            value: preferences.iconTheme ?? "lucide",
            label: "Markdown file icon theme",
            options: ICON_THEME_OPTIONS,
            onChange: (value) => {
              const option = ICON_THEME_OPTIONS.find((item) => item.value === value);
              if (option) {
                updatePreference("iconTheme", option.value);
              }
            },
          })}
        />
      </SettingsSection>

      <SettingsSection title="Diagnostics">
        <SettingsRow
          title="Log level"
          description="Verbosity requested from MD Review internals."
          control={selectControl({
            value: preferences.logLevel,
            label: "Markdown renderer log level",
            options: LOG_LEVEL_OPTIONS,
            onChange: (value) => {
              const option = LOG_LEVEL_OPTIONS.find((item) => item.value === value);
              if (option) {
                updatePreference("logLevel", option.value);
              }
            },
          })}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
