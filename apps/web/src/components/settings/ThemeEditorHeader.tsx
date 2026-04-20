import { useState, useRef } from "react";
import { CopyIcon, DownloadIcon, ImportIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../ui/dialog";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from "../ui/alert-dialog";
import { useTheme } from "../../hooks/useTheme";
import { themeStore } from "../../theme";
import type { ThemeBase } from "@t3tools/contracts";

export function ThemeEditorHeader() {
  const { themeSnapshot } = useTheme();
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [themeName, setThemeName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const themeItems = themeStore.listThemes().map((t) => ({ value: t.id, label: t.name }));

  const handleSelectTheme = (id: string | null) => {
    if (id) {
      themeStore.selectTheme(id);
    }
  };

  const handleNewTheme = () => {
    if (!themeName.trim()) return;
    const base = themeSnapshot.base as ThemeBase;
    themeStore.createTheme(themeName.trim(), base);
    setThemeName("");
    setNewDialogOpen(false);
  };

  const handleDuplicate = () => {
    if (!themeName.trim()) return;
    themeStore.duplicateTheme(themeName.trim());
    setThemeName("");
    setDuplicateDialogOpen(false);
  };

  const handleDelete = () => {
    themeStore.deleteTheme();
    setDeleteDialogOpen(false);
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
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        themeStore.importTheme(text);
      } catch {
        // import failed — silently ignore
      }
    });
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

        {/* New Theme */}
        <Dialog
          open={newDialogOpen}
          onOpenChange={(open) => {
            setNewDialogOpen(open);
            if (open) setThemeName("");
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNewDialogOpen(true)}
            title="New Theme"
          >
            <PlusIcon className="size-4" />
          </Button>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle>New Theme</DialogTitle>
              <DialogDescription>
                Create a new custom theme based on the current {themeSnapshot.base} theme.
              </DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-4">
              <Input
                ref={nameInputRef}
                value={themeName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThemeName(e.target.value)}
                placeholder="Theme name"
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter") handleNewTheme();
                }}
                autoFocus
              />
            </div>
            <DialogFooter variant="bare">
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleNewTheme} disabled={!themeName.trim()}>
                Create
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>

        {/* Duplicate */}
        <Dialog
          open={duplicateDialogOpen}
          onOpenChange={(open) => {
            setDuplicateDialogOpen(open);
            if (open) setThemeName(`${themeSnapshot.theme.name} (copy)`);
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDuplicateDialogOpen(true)}
            title="Duplicate"
          >
            <CopyIcon className="size-4" />
          </Button>
          <DialogPopup className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Duplicate Theme</DialogTitle>
              <DialogDescription>Create a copy of "{themeSnapshot.theme.name}".</DialogDescription>
            </DialogHeader>
            <div className="px-6 pb-4">
              <Input
                value={themeName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setThemeName(e.target.value)}
                placeholder="Theme name"
                onKeyDown={(e: React.KeyboardEvent) => {
                  if (e.key === "Enter") handleDuplicate();
                }}
                autoFocus
              />
            </div>
            <DialogFooter variant="bare">
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleDuplicate} disabled={!themeName.trim()}>
                Duplicate
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>

        {/* Delete */}
        {themeSnapshot.isCustom && (
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDeleteDialogOpen(true)}
              title="Delete"
            >
              <Trash2Icon className="size-4" />
            </Button>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Theme</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{themeSnapshot.theme.name}"? This cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                <Button variant="destructive" onClick={handleDelete}>
                  Delete
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
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
