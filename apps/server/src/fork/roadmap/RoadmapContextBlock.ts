/**
 * Fork: the roadmap block an attached thread's agent sees at the start of
 * every turn. The home renders it, for its own threads and for linked
 * environments, so every environment's agents see the same block.
 */
import type {
  RoadmapItemId,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapUnit,
  RoadmapWorkItem,
} from "@lathe/contracts";
import type { RoadmapForecastStatus } from "@lathe/shared/roadmapCalc";
import { effectivePriority } from "@lathe/shared/roadmap";

import type * as RoadmapProgress from "./RoadmapProgress.ts";

/** Roughly five hundred tokens: enough for the item, small enough to send every turn. */
export const ROADMAP_CONTEXT_MAX_CHARS = 2_000;

const TYPE_LABEL: Readonly<Record<RoadmapItemType, string>> = {
  objective: "Objective",
  "key-result": "Key result",
  initiative: "Initiative",
  epic: "Epic",
  feature: "Feature",
  story: "Story",
  bug: "Bug",
  "support-ticket": "Support ticket",
};

const STATE_LABEL: Readonly<Record<RoadmapItemState, string>> = {
  backlog: "Backlog",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};

// Per-field limits keep the fixed lines well under the cap, so the criteria
// always get most of it and the footer is never cut.
const TITLE_MAX = 120;
const ID_MAX = 80;
const ANCESTOR_TITLE_MAX = 60;
const CRITERION_MAX = 200;
const BLOCKERS_SHOWN = 5;

const FORECAST_LABEL: Readonly<Record<Exclude<RoadmapForecastStatus, "no-forecast">, string>> = {
  "on-track": "On track",
  "at-risk": "At risk",
  late: "Late",
};

const UNIT_LABEL: Readonly<Record<RoadmapUnit, string>> = {
  items: "items",
  criteria: "criteria",
  points: "pts",
  hours: "hours",
};

const INTRO = "Roadmap work item for this thread (Lathe roadmap, refreshed each turn):";
const FOOTER =
  "Use lathe_roadmap_read for criterion ids, and the lathe_roadmap_* tools to tick criteria with evidence or update this item.";

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;

function ancestorsOf(item: RoadmapWorkItem, byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>) {
  const ancestors: Array<RoadmapWorkItem> = [];
  const seen = new Set<RoadmapItemId>([item.id]);
  let parent = item.parentId === null ? undefined : byId.get(item.parentId);
  while (parent !== undefined && !seen.has(parent.id)) {
    seen.add(parent.id);
    ancestors.unshift(parent);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
  }
  return ancestors;
}

// One decimal is plenty for an agent, and keeps float noise out of the block.
const amount = (value: number) => String(Math.round(value * 10) / 10);

/** Null when there is neither a forecast nor anything done, so the line is left out. */
function progressLine(progress: RoadmapProgress.RoadmapItemProgress): string | null {
  const { forecast } = progress;
  if (forecast.status === "no-forecast" && progress.burned === 0) return null;
  const unit = UNIT_LABEL[progress.unit];
  const done =
    progress.total === null
      ? `${amount(progress.burned)} ${unit} done`
      : `${amount(progress.burned)} of ${amount(progress.total)} ${unit} done`;
  if (forecast.status === "no-forecast") return `Progress: ${done}.`;
  const projected = forecast.projected === null ? "" : `, projected ${forecast.projected}`;
  return `Forecast: ${FORECAST_LABEL[forecast.status]}${projected}; ${done}.`;
}

function blockedByLine(item: RoadmapWorkItem, byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>) {
  const blockers = [
    ...item.blockedBy.flatMap((blockerId) => {
      const blocker = byId.get(blockerId);
      return blocker === undefined || blocker.state === "done"
        ? []
        : [
            `${TYPE_LABEL[blocker.type]} "${clip(blocker.title, ANCESTOR_TITLE_MAX)}" (${STATE_LABEL[blocker.state]})`,
          ];
    }),
    ...item.externalBlockers.flatMap((blocker) =>
      blocker.resolvedAt === null ? [`"${clip(blocker.text, ANCESTOR_TITLE_MAX)}" (external)`] : [],
    ),
  ];
  if (blockers.length === 0) return "Blocked by: nothing.";
  const shown = blockers.slice(0, BLOCKERS_SHOWN);
  const more = blockers.length - shown.length;
  return `Blocked by: ${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}

/** The block for one item; `byId` holds the live items, for parents and blockers. */
export function renderRoadmapContext(
  item: RoadmapWorkItem,
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
  progress?: RoadmapProgress.RoadmapItemProgress,
): string {
  const priority = effectivePriority(item.id, byId).priority.toUpperCase();
  const due = item.dueDate === null ? "no due date" : `due ${item.dueDate}`;
  const ancestors = ancestorsOf(item, byId);
  const forecastLine = progress === undefined ? null : progressLine(progress);
  const header = [
    INTRO,
    `${TYPE_LABEL[item.type]} "${clip(item.title, TITLE_MAX)}" (id ${clip(item.id, ID_MAX)}), state ${STATE_LABEL[item.state]}, priority ${priority}, ${due}.`,
    ...(forecastLine === null ? [] : [forecastLine]),
    ...(ancestors.length === 0
      ? []
      : [
          `Parent: ${ancestors.map((ancestor) => clip(ancestor.title, ANCESTOR_TITLE_MAX)).join(" > ")}.`,
        ]),
  ];
  const footer = [blockedByLine(item, byId), FOOTER];
  const compose = (criteriaLines: ReadonlyArray<string>) =>
    [...header, ...criteriaLines, ...footer].join("\n");

  if (item.criteria.length === 0) return compose(["Acceptance criteria: none yet."]);
  const criterionLines = item.criteria.map(
    (criterion) =>
      `[${criterion.tickedAt === null ? " " : "x"}] ${clip(criterion.text, CRITERION_MAX)}`,
  );
  const section = (shown: number) => {
    const more = criterionLines.length - shown;
    return [
      "Acceptance criteria:",
      ...criterionLines.slice(0, shown),
      ...(more > 0 ? [`... and ${more} more ${more === 1 ? "criterion" : "criteria"}.`] : []),
    ];
  };
  let shown = criterionLines.length;
  while (shown > 0 && compose(section(shown)).length > ROADMAP_CONTEXT_MAX_CHARS) shown -= 1;
  return compose(section(shown));
}
