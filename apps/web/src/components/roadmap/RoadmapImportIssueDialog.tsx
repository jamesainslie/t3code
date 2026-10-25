/**
 * Fork: roadmap. Imports a GitHub issue and its sub-issues as work items. The
 * home reads the issue with the gh login its repository routes to, then keeps
 * the items in sync.
 */
import type { EnvironmentId, RoadmapArea, RoadmapItemId, RoadmapWorkItem } from "@lathe/contracts";
import { isRoadmapError } from "@lathe/contracts";
import { buildTree } from "@lathe/client-runtime/roadmap/tree";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@lathe/client-runtime/state/runtime";
import { useId, useState } from "react";

import { roadmapEnvironment } from "~/state/roadmap";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { ROADMAP_AREA_LABELS, ROADMAP_AREAS } from "./roadmap.logic";
import { roadmapImportUrlError } from "./roadmapCard.logic";
import { flattenOutline } from "./roadmapPage.logic";

const NO_PARENT = "none";

export function RoadmapImportIssueDialog({
  home,
  items,
  onClose,
}: {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  /** Receives the issue's item when the import created or found one. */
  readonly onClose: (itemId?: RoadmapItemId) => void;
}) {
  const id = useId();
  const importIssue = useAtomCommand(roadmapEnvironment.importRoadmapIssue, {
    label: "roadmap import issue",
    reportFailure: false,
  });
  const [url, setUrl] = useState("");
  const [parentId, setParentId] = useState<RoadmapItemId | null>(null);
  const [area, setArea] = useState<RoadmapArea>("work");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Bugs and support tickets hold nothing, so an issue cannot go under one.
  const parentOptions = flattenOutline(buildTree(items), new Set()).filter(
    (row) => row.node.item.type !== "bug" && row.node.item.type !== "support-ticket",
  );
  const parentItems = Object.fromEntries([
    [NO_PARENT, "No parent"],
    ...parentOptions.map((row) => [row.node.item.id, row.node.item.title]),
  ]);

  const submit = async () => {
    if (importing) return;
    const invalid = roadmapImportUrlError(url);
    if (invalid !== null) return setError(invalid);
    setImporting(true);
    const result = await importIssue({
      environmentId: home,
      input: { url: url.trim(), parentId, ...(parentId === null ? { area } : {}) },
    });
    setImporting(false);
    if (result._tag === "Success") {
      const { itemId, imported } = result.value;
      toastManager.add({
        type: "success",
        title:
          imported === 0
            ? "Already on the roadmap"
            : imported === 1
              ? "Imported the issue"
              : `Imported the issue and ${imported - 1} sub-issue${imported === 2 ? "" : "s"}`,
      });
      return onClose(itemId);
    }
    if (isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    setError(
      isRoadmapError(failure)
        ? failure.message
        : failure instanceof Error
          ? failure.message
          : String(failure),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Import GitHub issue</DialogTitle>
            <DialogDescription>
              The issue and its sub-issues become work items that stay in sync with GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-url`}>
                Issue URL
                <Input
                  id={`${id}-url`}
                  autoFocus
                  value={url}
                  placeholder="https://github.com/owner/repo/issues/12"
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setError(null);
                  }}
                />
              </Label>
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-parent`}>
                Parent
                <Select
                  value={parentId ?? NO_PARENT}
                  items={parentItems}
                  onValueChange={(value) =>
                    setParentId(
                      value === null || value === NO_PARENT ? null : (value as RoadmapItemId),
                    )
                  }
                >
                  <SelectTrigger id={`${id}-parent`} className="min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NO_PARENT}>No parent</SelectItem>
                    {parentOptions.map((row) => (
                      <SelectItem key={row.node.item.id} value={row.node.item.id}>
                        <span
                          className="truncate"
                          style={{ paddingInlineStart: `${row.depth * 12}px` }}
                        >
                          {row.node.item.title}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Label>
              {parentId === null ? (
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-area`}>
                  Area
                  <Select
                    value={area}
                    items={ROADMAP_AREA_LABELS}
                    onValueChange={(value) => {
                      if (value !== null) setArea(value as RoadmapArea);
                    }}
                  >
                    <SelectTrigger id={`${id}-area`} className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {ROADMAP_AREAS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {ROADMAP_AREA_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <span className="text-xs font-normal text-muted-foreground">
                    When the server maps the repository's GitHub login to an area, that area wins.
                  </span>
                </Label>
              ) : null}
              {error !== null ? (
                <p role="alert" className="text-sm text-destructive-foreground">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose()}>
              Cancel
            </Button>
            <Button type="submit" disabled={importing}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
