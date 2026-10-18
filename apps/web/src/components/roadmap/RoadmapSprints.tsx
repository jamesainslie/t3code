/**
 * Fork: roadmap. The page header's Sprints button and the dialog that
 * creates, edits and deletes sprints.
 */
import {
  type EnvironmentId,
  type IsoDate,
  type RoadmapArea,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { PencilIcon, TimerIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { randomUUID } from "~/lib/utils";
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
import { RoadmapAreaBadge } from "./RoadmapChips";
import { RoadmapDuePicker } from "./RoadmapFieldPickers";
import { ROADMAP_AREA_LABELS, ROADMAP_AREAS } from "./roadmap.logic";
import {
  buildSprintCommand,
  emptySprintDraft,
  formatSprintDates,
  sprintDeleteMessage,
  sprintDraftFor,
  sprintItemCount,
  type RoadmapSprintDraft,
  withSprintDraftArea,
} from "./roadmapSprints.logic";
import { newRoadmapCommandId, useRoadmapDispatch } from "./useRoadmapDispatch";

export interface RoadmapSprintsProps {
  readonly home: EnvironmentId;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly canEdit: boolean;
  readonly today: IsoDate;
}

export function RoadmapSprintsButton(props: RoadmapSprintsProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        <TimerIcon />
        Sprints
      </Button>
      {open ? <RoadmapSprintsDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const DEFAULT_AREA: RoadmapArea = "work";

function RoadmapSprintsDialog({
  home,
  items,
  sprints,
  canEdit,
  today,
  onClose,
}: RoadmapSprintsProps & { readonly onClose: () => void }) {
  const id = useId();
  const dispatch = useRoadmapDispatch(home);
  const [editing, setEditing] = useState<RoadmapSprint | null>(null);
  const [draft, setDraft] = useState<RoadmapSprintDraft>(() =>
    emptySprintDraft(sprints, DEFAULT_AREA, today),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<RoadmapSprintDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const startNew = (area: RoadmapArea = draft.area) => {
    setEditing(null);
    setDraft(emptySprintDraft(sprints, area, today));
    setError(null);
  };

  const submit = async () => {
    if (saving) return;
    const built = buildSprintCommand(draft, editing, {
      sprintId: editing?.id ?? RoadmapSprintId.make(randomUUID()),
      commandId: newRoadmapCommandId(),
    });
    if ("error" in built) return setError(built.error);
    if (built.command === null) return startNew();
    setSaving(true);
    const ok = await dispatch(
      built.command,
      editing === null ? "Could not create the sprint" : "Could not save the sprint",
    );
    setSaving(false);
    if (!ok) return;
    setEditing(null);
    setError(null);
    // The stream has not delivered the new sprint yet, so count it here for the next name.
    setDraft(
      emptySprintDraft(
        editing === null ? [...sprints, { area: draft.area }] : sprints,
        draft.area,
        today,
      ),
    );
  };

  const remove = async (sprint: RoadmapSprint) => {
    const confirmed = await requestConfirmDialog(
      sprintDeleteMessage(sprint, sprintItemCount(sprint.id, items)),
      { variant: "destructive" },
    );
    if (confirmed !== true) return;
    const ok = await dispatch(
      { type: "roadmap.sprint.delete", commandId: newRoadmapCommandId(), sprintId: sprint.id },
      "Could not delete the sprint",
    );
    if (ok && editing?.id === sprint.id) startNew();
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
            <DialogTitle>Sprints</DialogTitle>
            <DialogDescription>
              Items in a sprint forecast from the area's last three finished sprints once there are
              three.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              {sprints.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sprints yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sprints.map((sprint) => {
                    const count = sprintItemCount(sprint.id, items);
                    return (
                      <li key={sprint.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{sprint.name}</span>
                        <RoadmapAreaBadge area={sprint.area} />
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatSprintDates(sprint, today)}, {count}{" "}
                          {count === 1 ? "item" : "items"}
                        </span>
                        <span className="ms-auto flex shrink-0 items-center gap-0.5">
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Edit ${sprint.name}`}
                            disabled={!canEdit}
                            onClick={() => {
                              setEditing(sprint);
                              setDraft(sprintDraftFor(sprint));
                              setError(null);
                            }}
                          >
                            <PencilIcon />
                          </Button>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Delete ${sprint.name}`}
                            disabled={!canEdit}
                            onClick={() => void remove(sprint)}
                          >
                            <Trash2Icon />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <fieldset disabled={!canEdit} className="flex flex-col gap-3 border-t pt-4">
                <legend className="sr-only">
                  {editing === null ? "New sprint" : `Edit ${editing.name}`}
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-name`}>
                    {editing === null ? "New sprint" : `Editing ${editing.name}`}
                    <Input
                      id={`${id}-name`}
                      value={draft.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Label>
                  <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-area`}>
                    Area
                    <Select
                      value={draft.area}
                      items={ROADMAP_AREA_LABELS}
                      onValueChange={(value) => {
                        const area = ROADMAP_AREAS.find((option) => option === value);
                        if (area === undefined) return;
                        if (editing === null) {
                          setDraft((current) => withSprintDraftArea(current, area, sprints));
                          setError(null);
                        } else update({ area });
                      }}
                    >
                      <SelectTrigger id={`${id}-area`} className="min-w-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {ROADMAP_AREAS.map((area) => (
                          <SelectItem key={area} value={area}>
                            {ROADMAP_AREA_LABELS[area]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </Label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label>Starts</Label>
                    <RoadmapDuePicker
                      appearance="field"
                      label="Start date"
                      value={draft.startDate}
                      today={today}
                      onChange={(startDate) => {
                        if (startDate !== null) update({ startDate });
                      }}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label>Ends</Label>
                    <RoadmapDuePicker
                      appearance="field"
                      label="End date"
                      value={draft.endDate}
                      today={today}
                      onChange={(endDate) => {
                        if (endDate !== null) update({ endDate });
                      }}
                    />
                  </div>
                </div>
                {error !== null ? (
                  <p role="alert" className="text-sm text-destructive-foreground">
                    {error}
                  </p>
                ) : null}
              </fieldset>
            </div>
          </DialogPanel>
          <DialogFooter>
            {editing !== null ? (
              <Button type="button" variant="outline" onClick={() => startNew()}>
                Cancel edit
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
            <Button type="submit" disabled={!canEdit || saving}>
              {editing === null ? "Add sprint" : "Save sprint"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
