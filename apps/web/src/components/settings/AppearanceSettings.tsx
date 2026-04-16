import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

export function AppearanceSettings() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <div className="px-4 py-4 sm:px-5">
          <p className="text-sm text-muted-foreground">
            Customize colors, typography, transparency, and icons.
          </p>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
