import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";

/**
 * Curated font-family presets for the typography panel. Each preset's
 * `value` is the full CSS font-family stack that will be written to the
 * theme token; the `label` is what the user sees in the dropdown.
 *
 * The special empty-string value (`""`) signals "use the theme default"
 * and is translated into a `resetTypographyToken` call by the caller.
 */
export interface FontPreset {
  readonly label: string;
  readonly value: string;
}

export const UI_FONT_PRESETS: readonly FontPreset[] = [
  { label: "System default", value: "" },
  {
    label: "System UI",
    value:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "SF Pro", value: '"SF Pro Text", "SF Pro", system-ui, sans-serif' },
  { label: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { label: "Roboto", value: "Roboto, system-ui, sans-serif" },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia (serif)", value: 'Georgia, "Times New Roman", serif' },
];

/**
 * Nerd Fonts for the terminal. Each stack prefers the "Nerd Font Mono"
 * variant (single-width glyphs, best for terminal cell metrics), falls
 * back to the regular Nerd Font variant, and finally to system monospace
 * so the app still looks sane on machines where the font isn't installed.
 *
 * Family names follow the official Nerd Fonts naming convention
 * (https://www.nerdfonts.com). Users who install via Homebrew
 * (`brew install --cask font-<name>-nerd-font`) or the Nerd Fonts
 * installer will get these exact family names registered with the OS.
 */
export const TERMINAL_FONT_PRESETS: readonly FontPreset[] = [
  { label: "System default", value: "" },
  {
    label: "System Monospace",
    value: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  },
  {
    label: "JetBrainsMono Nerd Font",
    value:
      '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrains Mono", ui-monospace, monospace',
  },
  {
    label: "Hack Nerd Font",
    value: '"Hack Nerd Font Mono", "Hack Nerd Font", Hack, ui-monospace, monospace',
  },
  {
    label: "FiraCode Nerd Font",
    value: '"FiraCode Nerd Font Mono", "FiraCode Nerd Font", "Fira Code", ui-monospace, monospace',
  },
  {
    label: "MesloLGS Nerd Font",
    value:
      '"MesloLGS Nerd Font Mono", "MesloLGS Nerd Font", "MesloLGS NF", Menlo, ui-monospace, monospace',
  },
  {
    label: "Iosevka Nerd Font",
    value: '"Iosevka Nerd Font Mono", "Iosevka Nerd Font", Iosevka, ui-monospace, monospace',
  },
  {
    label: "CaskaydiaCove Nerd Font",
    value:
      '"CaskaydiaCove Nerd Font Mono", "CaskaydiaCove Nerd Font", "Cascadia Code", ui-monospace, monospace',
  },
  {
    label: "SauceCodePro Nerd Font",
    value:
      '"SauceCodePro Nerd Font Mono", "SauceCodePro Nerd Font", "Source Code Pro", ui-monospace, monospace',
  },
  {
    label: "Hasklug Nerd Font",
    value: '"Hasklug Nerd Font Mono", "Hasklug Nerd Font", Hasklig, ui-monospace, monospace',
  },
  {
    label: "RobotoMono Nerd Font",
    value:
      '"RobotoMono Nerd Font Mono", "RobotoMono Nerd Font", "Roboto Mono", ui-monospace, monospace',
  },
  {
    label: "UbuntuMono Nerd Font",
    value:
      '"UbuntuMono Nerd Font Mono", "UbuntuMono Nerd Font", "Ubuntu Mono", ui-monospace, monospace',
  },
  {
    label: "DejaVuSansMono Nerd Font",
    value:
      '"DejaVuSansMono Nerd Font Mono", "DejaVuSansMono Nerd Font", "DejaVu Sans Mono", ui-monospace, monospace',
  },
];

export const CODE_FONT_PRESETS: readonly FontPreset[] = [
  { label: "System default", value: "" },
  {
    label: "System Monospace",
    value: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  { label: "SF Mono", value: '"SF Mono", ui-monospace, monospace' },
  { label: "Menlo", value: "Menlo, ui-monospace, monospace" },
  { label: "Monaco", value: "Monaco, ui-monospace, monospace" },
  { label: "Consolas", value: "Consolas, ui-monospace, monospace" },
  { label: "JetBrains Mono", value: '"JetBrains Mono", ui-monospace, monospace' },
  { label: "Fira Code", value: '"Fira Code", ui-monospace, monospace' },
  { label: "Source Code Pro", value: '"Source Code Pro", ui-monospace, monospace' },
  { label: "IBM Plex Mono", value: '"IBM Plex Mono", ui-monospace, monospace' },
  { label: "Cascadia Code", value: '"Cascadia Code", ui-monospace, monospace' },
];

interface FontFamilySelectProps {
  readonly presets: readonly FontPreset[];
  /** Current resolved CSS font-family stack. */
  readonly value: string;
  /** True when the user has overridden this token (vs. using the theme default). */
  readonly isOverridden: boolean;
  /** Called with a preset value; empty string means "reset to default". */
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}

/**
 * Dropdown font picker backed by a curated preset list. When the current
 * value doesn't match any preset (e.g. legacy custom stack from before the
 * dropdown existed), the trigger shows "Custom…" but the list still lets
 * the user pick a known preset or fall back to System default.
 */
export function FontFamilySelect({
  presets,
  value,
  isOverridden,
  onChange,
  placeholder = "Font family…",
}: FontFamilySelectProps) {
  const matchingPreset = presets.find((preset) => preset.value && preset.value === value);
  // When the token is unset/overridden-to-default, select the empty-value
  // preset so the trigger shows "System default". When overridden but not
  // matching any preset, pass `undefined` so BaseUI renders the placeholder.
  const selectValue: string | undefined = !isOverridden ? "" : (matchingPreset?.value ?? undefined);

  const triggerText = !isOverridden ? "System default" : (matchingPreset?.label ?? "Custom…");

  return (
    <Select
      value={selectValue}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
    >
      <SelectTrigger size="sm" className="w-56">
        <SelectValue placeholder={placeholder}>{triggerText}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {presets.map((preset) => (
          <SelectItem key={preset.label} value={preset.value}>
            <span style={preset.value ? { fontFamily: preset.value } : undefined}>
              {preset.label}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
