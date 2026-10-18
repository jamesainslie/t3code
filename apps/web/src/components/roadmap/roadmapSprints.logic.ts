/**
 * Fork: roadmap. Pure rules behind the Sprints dialog and the sprint selects
 * on the card and in the editor.
 */
import type {
  CommandId,
  IsoDate,
  RoadmapArea,
  RoadmapCommand,
  RoadmapSprint,
  RoadmapSprintId,
  RoadmapSprintPatch,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { addDays } from "@lathe/shared/roadmapCalc";

import { formatRoadmapDate } from "./roadmapPage.logic";

const SPRINT_LENGTH_DAYS = 14;

/**
 * The sprints an item can join: its area's, plus the one it is already in so
 * the select can still name it. Null area offers every sprint.
 */
export function sprintOptionsFor(
  sprints: ReadonlyArray<RoadmapSprint>,
  area: RoadmapArea | null,
  currentId: RoadmapSprintId | null,
): ReadonlyArray<RoadmapSprint> {
  return sprints.filter(
    (sprint) => area === null || sprint.area === area || sprint.id === currentId,
  );
}

export function sprintItemCount(
  sprintId: RoadmapSprintId,
  items: ReadonlyArray<RoadmapWorkItem>,
): number {
  return items.filter((item) => item.sprintId === sprintId).length;
}

/** The confirm dialog's text: a title line, then what deleting does to the sprint's items. */
export function sprintDeleteMessage(sprint: RoadmapSprint, itemCount: number): string {
  const detail =
    itemCount === 0
      ? "No items are in it."
      : `Its ${itemCount} ${itemCount === 1 ? "item stays" : "items stay"} on the roadmap with no sprint.`;
  return `Delete ${sprint.name}?\n${detail}`;
}

export function formatSprintDates(sprint: RoadmapSprint, today: IsoDate): string {
  return `${formatRoadmapDate(sprint.startDate, today)} to ${formatRoadmapDate(sprint.endDate, today)}`;
}

export interface RoadmapSprintDraft {
  readonly name: string;
  readonly area: RoadmapArea;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
}

/** Two weeks from today, named after the area's sprint count so the next one is unique. */
export function emptySprintDraft(
  sprints: ReadonlyArray<Pick<RoadmapSprint, "area">>,
  area: RoadmapArea,
  today: IsoDate,
): RoadmapSprintDraft {
  const count = sprints.filter((sprint) => sprint.area === area).length;
  return {
    name: `Sprint ${count + 1}`,
    area,
    startDate: today,
    endDate: addDays(today, SPRINT_LENGTH_DAYS - 1),
  };
}

/** Moves a new sprint to another area, keeping a name the user typed and the chosen dates. */
export function withSprintDraftArea(
  draft: RoadmapSprintDraft,
  area: RoadmapArea,
  sprints: ReadonlyArray<Pick<RoadmapSprint, "area">>,
): RoadmapSprintDraft {
  const isDefaultName = draft.name === emptySprintDraft(sprints, draft.area, draft.startDate).name;
  const name = isDefaultName ? emptySprintDraft(sprints, area, draft.startDate).name : draft.name;
  return { ...draft, name, area };
}

export function sprintDraftFor(sprint: RoadmapSprint): RoadmapSprintDraft {
  return {
    name: sprint.name,
    area: sprint.area,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  };
}

/** A create, or an update of the changed fields; `command: null` when nothing changed. */
export function buildSprintCommand(
  draft: RoadmapSprintDraft,
  existing: RoadmapSprint | null,
  ids: { readonly sprintId: RoadmapSprintId; readonly commandId: CommandId },
): { readonly command: RoadmapCommand | null } | { readonly error: string } {
  const name = draft.name.trim();
  if (name === "") return { error: "Give the sprint a name." };
  if (draft.endDate < draft.startDate) return { error: "A sprint cannot end before it starts." };
  if (existing === null) {
    return {
      command: {
        type: "roadmap.sprint.create",
        commandId: ids.commandId,
        sprintId: ids.sprintId,
        name,
        area: draft.area,
        startDate: draft.startDate,
        endDate: draft.endDate,
      },
    };
  }
  const patch: { -readonly [K in keyof RoadmapSprintPatch]: RoadmapSprintPatch[K] } = {};
  if (name !== existing.name) patch.name = name;
  if (draft.area !== existing.area) patch.area = draft.area;
  if (draft.startDate !== existing.startDate) patch.startDate = draft.startDate;
  if (draft.endDate !== existing.endDate) patch.endDate = draft.endDate;
  if (Object.keys(patch).length === 0) return { command: null };
  return {
    command: {
      type: "roadmap.sprint.update",
      commandId: ids.commandId,
      sprintId: existing.id,
      patch,
    },
  };
}
