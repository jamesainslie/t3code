import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Fork setting: typeset TeX in chat messages. */
export function ChatMathSettings() {
  const enabled = useScopedSettings((settings) => settings.chatMathEnabled);
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("chat-math")}
      description="Typeset TeX such as $x^2$, $$…$$, \(…\) and \[…\] in chat messages. A price like $5 stays text."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => updateSettings({ chatMathEnabled: checked })}
          aria-label="Render math"
        />
      }
    />
  );
}
