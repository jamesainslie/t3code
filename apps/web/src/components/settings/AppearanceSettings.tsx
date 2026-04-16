import { useState } from "react";
import { SettingsPageContainer } from "./settingsLayout";
import { ThemeEditorHeader } from "./ThemeEditorHeader";
import { ThemeEditorTabs, type ThemeEditorTab } from "./ThemeEditorTabs";

export function AppearanceSettings() {
  const [activeTab, setActiveTab] = useState<ThemeEditorTab>("colors");

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-4">
        <ThemeEditorHeader />
        <ThemeEditorTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "colors" && (
          <div className="px-4 py-4 sm:px-5">
            <p className="text-sm text-muted-foreground">Colors panel coming next.</p>
          </div>
        )}
        {activeTab === "typography" && (
          <p className="text-sm text-muted-foreground">Typography settings coming in Phase 2.</p>
        )}
        {activeTab === "transparency" && (
          <p className="text-sm text-muted-foreground">Transparency settings coming in Phase 3.</p>
        )}
        {activeTab === "icons" && (
          <p className="text-sm text-muted-foreground">Icon set selection coming in Phase 4.</p>
        )}
      </div>
    </SettingsPageContainer>
  );
}
