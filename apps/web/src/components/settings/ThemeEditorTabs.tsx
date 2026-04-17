import { cn } from "../../lib/utils";

export type ThemeEditorTab = "colors" | "typography" | "transparency" | "icons";

interface ThemeEditorTabsProps {
  activeTab: ThemeEditorTab;
  onTabChange: (tab: ThemeEditorTab) => void;
}

const TABS: Array<{ id: ThemeEditorTab; label: string }> = [
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "transparency", label: "Transparency" },
  { id: "icons", label: "Icons" },
];

export function ThemeEditorTabs({ activeTab, onTabChange }: ThemeEditorTabsProps) {
  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            activeTab === tab.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
