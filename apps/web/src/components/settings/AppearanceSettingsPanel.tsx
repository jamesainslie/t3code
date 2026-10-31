import type { CSSProperties } from "react";
import { useState } from "react";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_THREAD_HIGHLIGHT_PALETTE,
  DEFAULT_UNIFIED_SETTINGS,
  type ChatWidth,
  type EffortDisplay,
  type EnvironmentIdentificationMode,
  type ThreadHighlightPaletteEntry,
  MAX_APPEARANCE_CONTRAST,
  MAX_GLASS_OPACITY,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_APPEARANCE_CONTRAST,
  MIN_GLASS_OPACITY,
  MIN_PANEL_ANIMATION_DURATION_MS,
} from "@lathe/contracts/settings";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useTheme } from "../../hooks/useTheme";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ThemeLibrary } from "./ThemeSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { AdvancedSettings } from "./AdvancedSettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";
import { TypographySection } from "./TypographySettings";
import { resolveColorPreference } from "../../appearanceColors";
import { Input } from "../ui/input";
import { ThemeColorPicker } from "./ThemeColorPicker";
import { EditionSettingsSection } from "./EditionSettings";
import { SyntaxThemeRow } from "./SyntaxThemeSettings";
import { isDefaultThreadHighlightPalette } from "./threadHighlightPaletteSettings";
import { ThreadDetailsItemsRow } from "./ThreadDetailsItemsRow";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: "Artwork",
  pill: "Version pill",
  none: "None",
};

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  comfortable: "Comfortable",
  wide: "Wide",
  full: "Full",
};

const EFFORT_DISPLAY_LABELS: Record<EffortDisplay, string> = {
  label: "Word",
  bars: "Bars",
};

export function AppearanceSettingsPanel() {
  const {
    appearanceMode,
    refreshTheme,
    resolvedTheme,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
  } = useTheme();
  const customThemes = useCustomThemes();
  const [isImportThemeOpen, setIsImportThemeOpen] = useState(false);
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  // Edition artwork shows on every build; the version pill only names Dev and Nightly.
  const pillAvailable = resolveEnvironmentIdentificationPillLabel(environmentStageLabel) !== null;
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--settings-slider-progress": `${glassOpacityRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;
  const appearanceContrastRatio =
    (settings.appearanceContrast - MIN_APPEARANCE_CONTRAST) /
    (MAX_APPEARANCE_CONTRAST - MIN_APPEARANCE_CONTRAST);
  const appearanceContrastSliderStyle = {
    "--settings-slider-progress": `${appearanceContrastRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - appearanceContrastRatio}rem`,
  } as CSSProperties;
  const panelAnimationDurationRatio =
    (settings.panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title="Colors & themes" variant="plain" hideTitle>
        <div id={searchableSetting("theme").id}>
          <ThemeLibrary
            appearanceMode={appearanceMode}
            customThemes={customThemes}
            initialAppearance={resolvedTheme}
            refreshTheme={refreshTheme}
            isImportOpen={isImportThemeOpen}
            setAppearanceMode={setAppearanceMode}
            setTheme={setTheme}
            setThemeHalf={setThemeHalf}
            theme={theme}
            themeHalves={themeHalves}
            onImportOpenChange={setIsImportThemeOpen}
          />
        </div>
      </SettingsSection>

      <EditionSettingsSection />

      <SettingsSection id="appearance-chat-colors" title="Chat colors">
        <ColorSettingsRow
          {...searchableSetting("chat-text-color")}
          title="Chat text"
          description="Message text in the conversation. Leave unset to use the theme's color."
          value={settings.chatTextColor}
          onValueChange={(chatTextColor) => updateSettings({ chatTextColor })}
          onReset={() => updateSettings({ chatTextColor: DEFAULT_UNIFIED_SETTINGS.chatTextColor })}
        />
        <ColorSettingsRow
          {...searchableSetting("composer-caret-color")}
          title="Prompt cursor"
          description="The text cursor in the box you write prompts in."
          value={settings.composerCaretColor}
          onValueChange={(composerCaretColor) => updateSettings({ composerCaretColor })}
          onReset={() =>
            updateSettings({ composerCaretColor: DEFAULT_UNIFIED_SETTINGS.composerCaretColor })
          }
        />
        <ColorSettingsRow
          {...searchableSetting("thread-card-color")}
          title="Thread cards"
          description="Resting background of thread cards in the sidebar. Hover and active tints are layered on top."
          value={settings.threadCardColor}
          onValueChange={(threadCardColor) => updateSettings({ threadCardColor })}
          onReset={() =>
            updateSettings({ threadCardColor: DEFAULT_UNIFIED_SETTINGS.threadCardColor })
          }
        />
        <ThreadHighlightPaletteRow />
      </SettingsSection>

      <SettingsSection id="appearance-interface" title="Interface">
        <SettingsRow
          {...searchableSetting("setting-appearance-contrast")}
          description="Adjust the contrast of colors and borders across the interface."
          resetAction={
            settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast ? (
              <SettingResetButton
                label="contrast"
                onClick={() =>
                  updateSettings({
                    appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="appearance-contrast"
              >
                {settings.appearanceContrast}%
              </output>
              <input
                aria-label="Contrast"
                className="settings-slider min-w-0 flex-1"
                id="appearance-contrast"
                max={MAX_APPEARANCE_CONTRAST}
                min={MIN_APPEARANCE_CONTRAST}
                onChange={(event) => {
                  const appearanceContrast = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(appearanceContrast) &&
                    appearanceContrast >= MIN_APPEARANCE_CONTRAST &&
                    appearanceContrast <= MAX_APPEARANCE_CONTRAST
                  ) {
                    updateSettings({ appearanceContrast });
                  }
                }}
                step={5}
                style={appearanceContrastSliderStyle}
                type="range"
                value={settings.appearanceContrast}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description="Higher values make menus, dialogs, and the composer more solid."
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                label="glass opacity"
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label="Glass opacity"
                className="settings-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        <SettingsRow
          {...searchableSetting("chat-width")}
          description="Set how wide messages and the composer can grow on large screens."
          resetAction={
            settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? (
              <SettingResetButton
                label="chat width"
                onClick={() => updateSettings({ chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth })}
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.chatWidth}
                onValueChange={(value) => {
                  if (value === "comfortable" || value === "wide" || value === "full")
                    updateSettings({ chatWidth: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Chat width">
                  <SelectValue>{CHAT_WIDTH_LABELS[settings.chatWidth]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="comfortable">Comfortable (default)</SelectItem>
                  <SelectItem value="wide">Wide</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <ThreadDetailsItemsRow />
        <SettingsRow
          {...searchableSetting("effort-display")}
          description="Show reasoning effort in the composer as its name, such as High, or as bars."
          resetAction={
            settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay ? (
              <SettingResetButton
                label="effort display"
                onClick={() =>
                  updateSettings({ effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay })
                }
              />
            ) : null
          }
          control={
            <div className="w-full sm:w-40">
              <Select
                value={settings.effortDisplay}
                onValueChange={(value) => {
                  if (value === "bars" || value === "label")
                    updateSettings({ effortDisplay: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Effort display">
                  <SelectValue>{EFFORT_DISPLAY_LABELS[settings.effortDisplay]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="label">Word (default)</SelectItem>
                  <SelectItem value="bars">Bars</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          }
        />
        <SettingsRow
          {...searchableSetting("math-rendering")}
          description="Typeset LaTeX math, such as $x^2$ or \[x^2\], in messages and Markdown previews. The composer keeps TeX source editable."
          resetAction={
            settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled ? (
              <SettingResetButton
                label="math rendering"
                onClick={() =>
                  updateSettings({
                    mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.mathRenderingEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ mathRenderingEnabled: Boolean(checked) })
              }
              aria-label="Render math"
            />
          }
        />
        <SyntaxThemeRow />
        <AdvancedSettings
          targetIds={[
            searchableSetting("panel-animations").id,
            searchableSetting("environment-identification").id,
            // Environment identification's search result lands on this section.
            "appearance-interface",
            searchableSetting("composer-context").id,
          ]}
        >
          <SettingsRow
            {...searchableSetting("panel-animations")}
            description="Set how fast panels open and close."
            control={
              <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
                <PanelAnimationsPreview durationMs={settings.panelAnimationDurationMs} />
                <div className="flex w-full items-center gap-3">
                  <output
                    className="min-w-16 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                    htmlFor="panel-animation-duration"
                  >
                    {settings.panelAnimationDurationMs} ms
                  </output>
                  <input
                    aria-label="Panel animation duration"
                    className="settings-slider min-w-0 flex-1"
                    id="panel-animation-duration"
                    max={MAX_PANEL_ANIMATION_DURATION_MS}
                    min={MIN_PANEL_ANIMATION_DURATION_MS}
                    onChange={(event) => {
                      const panelAnimationDurationMs = Number(event.currentTarget.value);
                      if (
                        Number.isInteger(panelAnimationDurationMs) &&
                        panelAnimationDurationMs >= MIN_PANEL_ANIMATION_DURATION_MS &&
                        panelAnimationDurationMs <= MAX_PANEL_ANIMATION_DURATION_MS
                      ) {
                        updateSettings({ panelAnimationDurationMs });
                      }
                    }}
                    step={25}
                    style={panelAnimationDurationSliderStyle}
                    type="range"
                    value={settings.panelAnimationDurationMs}
                  />
                </div>
              </div>
            }
            resetAction={
              settings.panelAnimationDurationMs !==
              DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs ? (
                <SettingResetButton
                  label="panel animations"
                  onClick={() =>
                    updateSettings({
                      panelAnimationDurationMs: DEFAULT_UNIFIED_SETTINGS.panelAnimationDurationMs,
                    })
                  }
                />
              ) : null
            }
          />
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description={
              pillAvailable
                ? "Show the edition artwork in the sidebar header, a version pill, or nothing."
                : "Show the edition artwork in the sidebar header, or nothing."
            }
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  label="environment identification"
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  if (value === "artwork" || value === "pill" || value === "none") {
                    updateSettings({ environmentIdentificationMode: value });
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label="Environment identification"
                >
                  <SelectValue>
                    {ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(ENVIRONMENT_IDENTIFICATION_LABELS)
                    .filter(([value]) => pillAvailable || value !== "pill")
                    .map(([value, label]) => (
                      <SelectItem hideIndicator key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            {...searchableSetting("composer-context")}
            description="Keep branch and worktree controls below the composer after a thread starts."
            resetAction={
              settings.persistComposerContextStrip !==
              DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip ? (
                <SettingResetButton
                  label="composer context"
                  onClick={() =>
                    updateSettings({
                      persistComposerContextStrip:
                        DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.persistComposerContextStrip}
                onCheckedChange={(checked) =>
                  updateSettings({ persistComposerContextStrip: Boolean(checked) })
                }
                aria-label="Keep composer context visible in active threads"
              />
            }
          />
        </AdvancedSettings>
      </SettingsSection>

      <TypographySection />
    </SettingsPageContainer>
  );
}

/**
 * The twelve colors offered under Highlight in a thread's context menu. The
 * label is what the menu shows, so it is editable beside the swatch.
 */
function ThreadHighlightPaletteRow() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const palette = settings.threadHighlightPalette;
  const updateEntry = (index: number, patch: Partial<ThreadHighlightPaletteEntry>) => {
    updateSettings({
      threadHighlightPalette: palette.map((entry, at) =>
        at === index ? { ...entry, ...patch } : entry,
      ),
    });
  };
  return (
    <SettingsRow
      {...searchableSetting("thread-highlight-palette")}
      title="Highlight palette"
      description="Colors offered when you right-click a thread and choose Highlight. Each slot has a menu label and a color."
      resetAction={
        isDefaultThreadHighlightPalette(palette) ? null : (
          <SettingResetButton
            label="highlight palette"
            onClick={() =>
              updateSettings({ threadHighlightPalette: DEFAULT_THREAD_HIGHLIGHT_PALETTE })
            }
          />
        )
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {palette.map((entry, index) => {
          const resolved = resolveColorPreference(entry.color);
          return (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- fixed slots addressed by position
              key={index}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5"
            >
              <ThemeColorPicker
                label={entry.label || `Color ${index + 1}`}
                onChange={(color) => updateEntry(index, { color })}
                value={resolved ?? "#808080"}
              />
              <Input
                aria-label={`Highlight ${index + 1} label`}
                className="min-w-0 flex-1"
                nativeInput
                onChange={(event) => updateEntry(index, { label: event.currentTarget.value })}
                placeholder={`Color ${index + 1}`}
                value={entry.label}
              />
              <Input
                aria-invalid={resolved === null}
                aria-label={`Highlight ${index + 1} hex value`}
                className="w-24 shrink-0 [&_[data-slot=input]]:text-right"
                font="mono"
                nativeInput
                onChange={(event) => updateEntry(index, { color: event.currentTarget.value })}
                spellCheck={false}
                value={entry.color}
              />
            </div>
          );
        })}
      </div>
    </SettingsRow>
  );
}

/**
 * One optional color override. An unset value shows a neutral swatch and no
 * reset; the hex field accepts the same syntax as the theme editor.
 */
function ColorSettingsRow({
  id,
  title,
  description,
  value,
  onValueChange,
  onReset,
}: {
  id?: string;
  title: string;
  description: string;
  value: string;
  onValueChange: (value: string) => void;
  onReset: () => void;
}) {
  const resolved = resolveColorPreference(value);
  const isUnset = value.trim().length === 0;
  return (
    <SettingsRow
      {...(id !== undefined ? { id } : {})}
      title={title}
      description={description}
      resetAction={
        isUnset ? null : <SettingResetButton label={title.toLowerCase()} onClick={onReset} />
      }
      control={
        <div className="flex items-center gap-2">
          <ThemeColorPicker label={title} onChange={onValueChange} value={resolved ?? "#808080"} />
          <Input
            aria-invalid={!isUnset && resolved === null}
            aria-label={`${title} hex value`}
            className="w-28 shrink-0 [&_[data-slot=input]]:text-right"
            font="mono"
            nativeInput
            onChange={(event) => onValueChange(event.currentTarget.value)}
            placeholder="Theme"
            spellCheck={false}
            value={value}
          />
        </div>
      }
    />
  );
}
