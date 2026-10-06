import { useAtomSet } from "@effect/atom-react";
import { useCallback } from "react";

import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_STEP,
} from "../../../../lib/appearancePreferences";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import {
  AppearancePreviewSeparator,
  TerminalAppearancePreview,
} from "../components/AppearancePreviews";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { updateMobilePreferencesAtom } from "../../../../state/preferences";
import { useCommandDisplayMode } from "../../../../state/use-command-display-mode";

export function TerminalAppearanceSection() {
  const { isReady, appearance, setTerminalFontSize } = useAppearancePreferences();
  const custom = appearance.isTerminalFontSizeCustom;
  const commandDisplayMode = useCommandDisplayMode();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);

  const handleToggleCustom = useCallback(
    (enabled: boolean) => {
      setTerminalFontSize(enabled ? appearance.terminalFontSize : null);
    },
    [appearance.terminalFontSize, setTerminalFontSize],
  );

  return (
    <SettingsSection title="Terminal">
      <TerminalAppearancePreview fontSize={appearance.terminalFontSize} />
      <AppearancePreviewSeparator />
      <SettingsSwitchRow
        disabled={!isReady}
        icon="terminal"
        label="Custom font size"
        onValueChange={handleToggleCustom}
        value={custom}
      />
      {custom ? (
        <FontSizeSliderRow
          disabled={!isReady}
          icon="textformat.size"
          label="Font size"
          max={MAX_TERMINAL_FONT_SIZE}
          min={MIN_TERMINAL_FONT_SIZE}
          onChange={setTerminalFontSize}
          step={TERMINAL_FONT_SIZE_STEP}
          value={appearance.terminalFontSize}
          valueLabel={`${appearance.terminalFontSize.toFixed(1)} pt`}
        />
      ) : null}
      <SettingsSwitchRow
        disabled={!isReady}
        icon="chevron.left.forwardslash.chevron.right"
        label="Expose commands"
        subtitle="Show every command's output in threads. Off still opens failed commands."
        onValueChange={(exposed) =>
          savePreferences({ commandDisplayMode: exposed ? "exposed" : "collapsed" })
        }
        value={commandDisplayMode === "exposed"}
      />
    </SettingsSection>
  );
}
