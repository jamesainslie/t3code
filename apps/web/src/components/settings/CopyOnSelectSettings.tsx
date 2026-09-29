import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Fork setting: copy text to the clipboard as soon as it is selected. */
export function CopyOnSelectSettings() {
  const enabled = useScopedSettings((settings) => settings.copyOnSelectEnabled);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("copy-on-select")}
      description="Copy text to the clipboard as soon as you select it. Text you select while editing, such as in the composer, is not copied."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => updateSettings({ copyOnSelectEnabled: checked })}
          aria-label="Copy selected text"
        />
      }
    />
  );
}
