import type {
  EnvironmentId,
  RoadmapArea,
  RoadmapItemId,
  RoadmapItemType,
  RoadmapPriority,
  RoadmapSprint,
  RoadmapSprintId,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { buildTree, roadmapItemsById } from "@lathe/client-runtime/roadmap/tree";
import { effectiveArea } from "@lathe/shared/roadmap";
import { useEffect, useId, useState } from "react";

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
import { Textarea } from "../ui/textarea";
import { RoadmapDuePicker, RoadmapEstimateField } from "./RoadmapFieldPickers";
import {
  ROADMAP_AREA_LABELS,
  ROADMAP_AREAS,
  ROADMAP_PRIORITIES,
  ROADMAP_PRIORITY_LABELS,
  ROADMAP_TYPE_LABELS,
  localIsoDate,
} from "./roadmap.logic";
import {
  ancestorIds,
  buildCreateCommand,
  buildEditCommands,
  editorDraftFor,
  emptyEditorDraft,
  flattenOutline,
  typeOptionsFor,
  type RoadmapEditorDraft,
} from "./roadmapPage.logic";
import { roadmapReadOnlyHint } from "./roadmapCard.logic";
import { sprintOptionsFor } from "./roadmapSprints.logic";
import { newRoadmapCommandId, newRoadmapItemId, useRoadmapDispatch } from "./useRoadmapDispatch";

export type RoadmapItemEditorMode =
  | { readonly kind: "create"; readonly parentId: RoadmapItemId | null }
  | { readonly kind: "edit"; readonly item: RoadmapWorkItem };

export interface RoadmapItemEditorProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly mode: RoadmapItemEditorMode;
  /** Receives the new item's id when the editor created one. */
  readonly onClose: (createdId?: RoadmapItemId) => void;
}

const NO_PARENT = "none";
const INHERIT = "inherit";
const NO_SPRINT = "none";

/** Creates a work item, or edits every field of one, in a dialog. */
export function RoadmapItemEditor({ home, items, sprints, mode, onClose }: RoadmapItemEditorProps) {
  const id = useId();
  const dispatch = useRoadmapDispatch(home);
  const byId = roadmapItemsById(items);
  const editing = mode.kind === "edit" ? mode.item : null;
  const readOnlyHint = editing === null ? null : roadmapReadOnlyHint(editing);
  const [draft, setDraft] = useState<RoadmapEditorDraft>(() => {
    if (mode.kind === "edit") return editorDraftFor(mode.item);
    const parent = mode.parentId === null ? null : (byId.get(mode.parentId) ?? null);
    return emptyEditorDraft(parent?.id ?? null, parent?.type ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const today = localIsoDate(new Date());
  const update = (patch: Partial<RoadmapEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  // Opening an item an agent created counts as reviewing it.
  const reviewItemId = editing?.needsReview === true ? editing.id : null;
  useEffect(() => {
    if (reviewItemId === null) return;
    void dispatch({
      type: "roadmap.item.mark-reviewed",
      commandId: newRoadmapCommandId(),
      itemId: reviewItemId,
    });
  }, [dispatch, reviewItemId]);

  const childTypes =
    editing === null
      ? []
      : items.filter((entry) => entry.parentId === editing.id).map((entry) => entry.type);
  const parentType = draft.parentId === null ? null : (byId.get(draft.parentId)?.type ?? null);
  const typeOptions = typeOptionsFor(parentType, childTypes);
  const parentOptions = (() => {
    const excluded = new Set<RoadmapItemId>();
    if (editing !== null) {
      excluded.add(editing.id);
      for (const entry of items) {
        if (ancestorIds(entry.id, byId).includes(editing.id)) excluded.add(entry.id);
      }
    }
    return flattenOutline(buildTree(items), new Set()).filter(
      (row) =>
        !excluded.has(row.node.item.id) &&
        typeOptionsFor(row.node.item.type, childTypes).includes(draft.type),
    );
  })();

  const submit = async () => {
    if (saving) return;
    if (editing === null) {
      const itemId = newRoadmapItemId();
      const built = buildCreateCommand(draft, { itemId, commandId: newRoadmapCommandId() });
      if ("error" in built) return setError(built.error);
      setSaving(true);
      const ok = await dispatch([built.command], "Could not create the work item");
      setSaving(false);
      if (ok) onClose(itemId);
      return;
    }
    const built = buildEditCommands(editing, draft, newRoadmapCommandId, byId);
    if ("error" in built) return setError(built.error);
    setSaving(true);
    const ok = await dispatch(built.commands, "Could not save the work item");
    setSaving(false);
    if (ok) onClose();
  };

  // The area the item will have once saved, so the select offers that area's sprints.
  const area =
    draft.area ??
    (draft.parentId !== null && byId.has(draft.parentId)
      ? effectiveArea(draft.parentId, byId).area
      : editing !== null
        ? effectiveArea(editing.id, byId).area
        : null);
  const sprintOptions = sprintOptionsFor(sprints, area, draft.sprintId);
  const sprintItems = Object.fromEntries([
    [NO_SPRINT, "No sprint"],
    ...sprintOptions.map((sprint) => [sprint.id, sprint.name]),
  ]);

  const parentItems = Object.fromEntries([
    [NO_PARENT, "No parent"],
    ...parentOptions.map((row) => [row.node.item.id, row.node.item.title]),
  ]);

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
            <DialogTitle>{editing === null ? "New work item" : "Edit work item"}</DialogTitle>
            <DialogDescription>
              {editing === null
                ? "Leave priority and area to inherit them from the parent."
                : (readOnlyHint ?? "Changes apply as soon as you save.")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-type`}>
                  Type
                  <Select
                    value={draft.type}
                    items={ROADMAP_TYPE_LABELS}
                    onValueChange={(value) => {
                      if (value !== null) update({ type: value as RoadmapItemType });
                    }}
                  >
                    <SelectTrigger id={`${id}-type`} className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {typeOptions.map((type) => (
                        <SelectItem key={type} value={type}>
                          {ROADMAP_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-title`}>
                  Title
                  <Input
                    id={`${id}-title`}
                    autoFocus
                    disabled={readOnlyHint !== null}
                    value={draft.title}
                    placeholder="What should be true when this is done?"
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </Label>
              </div>
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-parent`}>
                Parent
                <Select
                  value={draft.parentId ?? NO_PARENT}
                  items={parentItems}
                  onValueChange={(value) =>
                    update({
                      parentId:
                        value === null || value === NO_PARENT ? null : (value as RoadmapItemId),
                    })
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-area`}>
                  Area
                  <Select
                    value={draft.area ?? INHERIT}
                    items={{ [INHERIT]: "Inherit", ...ROADMAP_AREA_LABELS }}
                    onValueChange={(value) =>
                      update({
                        area: value === null || value === INHERIT ? null : (value as RoadmapArea),
                      })
                    }
                  >
                    <SelectTrigger id={`${id}-area`} className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value={INHERIT}>Inherit</SelectItem>
                      {ROADMAP_AREAS.map((area) => (
                        <SelectItem key={area} value={area}>
                          {ROADMAP_AREA_LABELS[area]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-priority`}>
                  Priority
                  <Select
                    value={draft.priority ?? INHERIT}
                    items={{ [INHERIT]: "Inherit", ...ROADMAP_PRIORITY_LABELS }}
                    onValueChange={(value) =>
                      update({
                        priority:
                          value === null || value === INHERIT ? null : (value as RoadmapPriority),
                      })
                    }
                  >
                    <SelectTrigger id={`${id}-priority`} className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value={INHERIT}>Inherit</SelectItem>
                      {ROADMAP_PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {ROADMAP_PRIORITY_LABELS[priority]}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
                <div className="flex min-w-0 flex-col gap-2">
                  <Label>Due</Label>
                  <RoadmapDuePicker
                    appearance="field"
                    label="Due date"
                    value={draft.dueDate}
                    today={today}
                    onChange={(dueDate) => update({ dueDate })}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <Label>Estimate</Label>
                  <RoadmapEstimateField
                    label="Estimate"
                    value={draft.estimate}
                    onChange={(estimate) => update({ estimate })}
                  />
                </div>
              </div>
              {sprints.length > 0 ? (
                <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-sprint`}>
                  Sprint
                  <Select
                    value={draft.sprintId ?? NO_SPRINT}
                    items={sprintItems}
                    onValueChange={(value) =>
                      update({
                        sprintId:
                          value === null || value === NO_SPRINT ? null : (value as RoadmapSprintId),
                      })
                    }
                  >
                    <SelectTrigger id={`${id}-sprint`} className="min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value={NO_SPRINT}>No sprint</SelectItem>
                      {sprintOptions.map((sprint) => (
                        <SelectItem key={sprint.id} value={sprint.id}>
                          {sprint.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Label>
              ) : null}
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-criteria`}>
                Acceptance criteria
                <Textarea
                  id={`${id}-criteria`}
                  rows={4}
                  value={draft.criteriaText}
                  placeholder="One criterion per line."
                  onChange={(event) => update({ criteriaText: event.target.value })}
                />
              </Label>
              <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-description`}>
                Description
                <Textarea
                  id={`${id}-description`}
                  rows={3}
                  value={draft.description}
                  placeholder="Optional. Markdown is fine."
                  onChange={(event) => update({ description: event.target.value })}
                />
              </Label>
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
            <Button type="submit" disabled={saving}>
              {editing === null ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
