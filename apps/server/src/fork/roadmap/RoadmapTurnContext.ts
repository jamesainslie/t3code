/**
 * Fork: the roadmap block an attached thread's agent sees at the start of
 * every turn. It rides in the provider-bound text, so it reaches every adapter
 * the same way and never lands in the stored user message.
 */
import type {
  RoadmapItemId,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapWorkItem,
  ThreadId,
} from "@lathe/contracts";
import { effectivePriority } from "@lathe/shared/roadmap";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as RoadmapService from "./RoadmapService.ts";

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
): string {
  const priority = effectivePriority(item.id, byId).priority.toUpperCase();
  const due = item.dueDate === null ? "no due date" : `due ${item.dueDate}`;
  const ancestors = ancestorsOf(item, byId);
  const header = [
    INTRO,
    `${TYPE_LABEL[item.type]} "${clip(item.title, TITLE_MAX)}" (id ${clip(item.id, ID_MAX)}), state ${STATE_LABEL[item.state]}, priority ${priority}, ${due}.`,
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

export class RoadmapTurnContext extends Context.Service<
  RoadmapTurnContext,
  {
    /**
     * The block for the thread's work item, or "" when it has none, this is not
     * the roadmap home, or the roadmap cannot be read. Never fails, so a
     * roadmap problem can never stop a turn.
     */
    readonly forThread: (threadId: ThreadId) => Effect.Effect<string>;
  }
>()("lathe/fork/roadmap/RoadmapTurnContext") {}

const make = Effect.gen(function* () {
  const roadmap = yield* RoadmapService.RoadmapService;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;

  return RoadmapTurnContext.of({
    forThread: (threadId) =>
      Effect.gen(function* () {
        if (!(yield* roadmap.isHome)) return "";
        const environmentId = yield* identity.getEnvironmentId;
        // Phase 1 attaches a thread to one item at a time.
        const [item] = yield* roadmap.forThread({ environmentId, threadId });
        if (item === undefined) return "";
        const items = yield* roadmap.list();
        return renderRoadmapContext(item, new Map(items.map((live) => [live.id, live])));
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Roadmap context skipped for this turn", { threadId, error }).pipe(
            Effect.as(""),
          ),
        ),
        Effect.catchDefect((defect) =>
          Effect.logWarning("Roadmap context skipped for this turn", { threadId, defect }).pipe(
            Effect.as(""),
          ),
        ),
        Effect.withSpan("RoadmapTurnContext.forThread"),
      ),
  });
});

export const layer = Layer.effect(RoadmapTurnContext, make);
