import { useMemo } from "react";
import { CopyIcon, DownloadIcon, ImportIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useTheme } from "../../hooks/useTheme";
import { themeStore } from "../../theme";
import type { ThemeBase } from "@t3tools/contracts";

export function ThemeEditorHeader() {
  const { themeSnapshot } = useTheme();

  const themeItems = useMemo(() => {
    const themes = themeStore.listThemes();
    return themes.map((t) => ({ value: t.id, label: t.name }));
  }, [themeSnapshot]);

  const handleSelectTheme = (id: string | null) => {
    if (id) {
      themeStore.selectTheme(id);
    }
  };

  const handleNewTheme = () => {
    const name = prompt("Theme name:");
    if (!name) return;
    const base = themeSnapshot.base as ThemeBase;
    themeStore.createTheme(name, base);
  };

  const handleDuplicate = () => {
    const name = prompt("Name for duplicate:", `${themeSnapshot.theme.name} (copy)`);
    if (!name) return;
    themeStore.duplicateTheme(name);
  };

  const handleDelete = () => {
    if (!themeSnapshot.isCustom) return;
    if (!confirm(`Delete "${themeSnapshot.theme.name}"?`)) return;
    themeStore.deleteTheme();
  };

  const handleExport = () => {
    const json = themeStore.exportTheme();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${themeSnapshot.theme.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        themeStore.importTheme(text);
      } catch (err) {
        alert(`Failed to import theme: ${err}`);
      }
    };
    input.click();
  };

  const handleDiscard = () => {
    themeStore.discardChanges();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select value={themeSnapshot.theme.id} onValueChange={handleSelectTheme} items={themeItems}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {themeItems.map((t) => (
              <SelectItem key={t.value} value={t.value} hideIndicator>
                {t.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Button variant="ghost" size="icon" onClick={handleNewTheme} title="New Theme">
          <PlusIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={handleDuplicate} title="Duplicate">
          <CopyIcon className="size-4" />
        </Button>
        {themeSnapshot.isCustom && (
          <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete">
            <Trash2Icon className="size-4" />
          </Button>
        )}

        <div className="flex-1" />

        <Button variant="ghost" size="sm" onClick={handleImport}>
          <ImportIcon className="size-3.5 mr-1.5" />
          Import
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExport}>
          <DownloadIcon className="size-3.5 mr-1.5" />
          Export
        </Button>

        {themeSnapshot.isDirty && (
          <Button variant="outline" size="sm" onClick={handleDiscard}>
            Discard Changes
          </Button>
        )}
      </div>
    </div>
  );
}
