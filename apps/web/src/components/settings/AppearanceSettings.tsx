import { useState } from "react";
import { SettingsPageContainer } from "./settingsLayout";
import { ThemeEditorHeader } from "./ThemeEditorHeader";
import { ThemeEditorTabs, type ThemeEditorTab } from "./ThemeEditorTabs";
import { ColorsPanel } from "./theme-editor/ColorsPanel";
import { TypographyPanel } from "./theme-editor/TypographyPanel";
import { TransparencyPanel } from "./theme-editor/TransparencyPanel";
import { IconsPanel } from "./theme-editor/IconsPanel";

export function AppearanceSettings() {
  const [activeTab, setActiveTab] = useState<ThemeEditorTab>("colors");

  return (
    <SettingsPageContainer>
      <div className="flex flex-col gap-4">
        <ThemeEditorHeader />
        <ThemeEditorTabs activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === "colors" && <ColorsPanel />}
        {activeTab === "typography" && <TypographyPanel />}
        {activeTab === "transparency" && <TransparencyPanel />}
        {activeTab === "icons" && <IconsPanel />}
      </div>
    </SettingsPageContainer>
  );
}
