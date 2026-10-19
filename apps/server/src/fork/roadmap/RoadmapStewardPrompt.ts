/**
 * Fork: roadmap. What the steward asks the model and what it does with the
 * answer. Pure, so the rules that keep the steward honest (cite a new turn,
 * say "unsure" rather than guess) are tested without a model.
 */
import {
  CommandId,
  type RoadmapCommand,
  type RoadmapStoredEvent,
  type RoadmapWorkItem,
  type ThreadId,
} from "@lathe/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { buildThreadDigest } from "../../mcp/toolkits/threadHistory/digest.ts";
import { renderThreadDigest } from "../../mcp/toolkits/threadHistory/render.ts";
import { reconstructTurns, type HistoryThread } from "../../mcp/toolkits/threadHistory/turns.ts";

/** Half the thread-history budget: the steward runs after every turn on a cheap model. */
const STEWARD_DIGEST_BYTES = 12_288;
const DESCRIPTION_MAX = 1_500;
const NOTES_SHOWN = 5;
/** A run that writes more than this is rambling; the rest are dropped. */
const NOTES_PER_RUN = 4;
const TEXT_MAX = 600;

// Every key is required and nullable rather than optional, because strict
// structured-output modes (Codex) refuse optional properties.
export const StewardFindings = Schema.Struct({
  ticks: Schema.Array(
    Schema.Struct({
      criterionId: Schema.String,
      /** The new turn whose work meets the criterion. */
      turn: Schema.Int,
      evidence: Schema.String,
    }),
  ),
  notes: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["progress", "drift", "unsure"]),
      text: Schema.String,
      criterionId: Schema.NullOr(Schema.String),
    }),
  ),
});
export type StewardFindings = typeof StewardFindings.Type;

export interface StewardTurn {
  readonly n: number;
  /** When the turn's run ended, ISO. */
  readonly endedAt: string;
}

/**
 * Turns whose run ended after `digestedUntil`, oldest first. Running and
 * queued turns wait for the next run; imported turns have no end time and are
 * never new.
 */
export function stewardNewTurns(
  thread: HistoryThread,
  digestedUntil: string | null,
): ReadonlyArray<StewardTurn> {
  const endedAt = new Map(
    thread.runs.flatMap((run) =>
      run.completedAt === null ? [] : [[run.id, DateTime.formatIso(run.completedAt)] as const],
    ),
  );
  const since = digestedUntil === null ? Number.NEGATIVE_INFINITY : Date.parse(digestedUntil);
  return reconstructTurns(thread).flatMap((turn) => {
    if (turn.runId === null || turn.state === "running" || turn.state === "queued") return [];
    const ended = endedAt.get(turn.runId);
    return ended !== undefined && Date.parse(ended) > since ? [{ n: turn.n, endedAt: ended }] : [];
  });
}

/** The newest untick per criterion in the item's history. */
export function criterionUntickTimes(
  history: ReadonlyArray<RoadmapStoredEvent>,
): ReadonlyMap<string, string> {
  const times = new Map<string, string>();
  for (const { event } of history) {
    if (event.type === "roadmap.criterion.ticked" && !event.payload.ticked) {
      times.set(event.payload.criterionId, event.occurredAt);
    }
  }
  return times;
}

/** The thread in the thread-history format, the new turns in full and older ones in a line. */
export function stewardDigest(input: {
  readonly thread: HistoryThread;
  readonly projectTitle: string | null;
  readonly newTurns: number;
}): string {
  return renderThreadDigest(
    buildThreadDigest({
      thread: input.thread,
      comments: [],
      projectTitle: input.projectTitle,
      continuedFromTitle: null,
      callerWorktreePath: null,
      recentTurns: input.newTurns,
    }),
    STEWARD_DIGEST_BYTES,
  );
}

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

function criterionLine(
  criterion: RoadmapWorkItem["criteria"][number],
  untickedAt: string | undefined,
): string {
  const state =
    criterion.tickedAt !== null
      ? "ticked, leave it alone"
      : untickedAt === undefined
        ? "open"
        : `open, unticked by the user at ${untickedAt}: tick it only for a turn that ended after that`;
  return `- [${criterion.id}] (${state}) ${criterion.text}`;
}

export function buildStewardPrompt(input: {
  readonly item: RoadmapWorkItem;
  readonly untickedAt: ReadonlyMap<string, string>;
  readonly newTurns: ReadonlyArray<StewardTurn>;
  readonly digest: string;
}): string {
  const { item } = input;
  const notes = item.progressNotes.slice(-NOTES_SHOWN);
  return [
    "You are the roadmap steward. You read a coding agent's thread and relate its work to the work item the thread is attached to and its acceptance criteria. You report what the thread shows. You never decide what the work should be.",
    "",
    `Work item: ${item.title}`,
    ...(item.description.trim().length > 0
      ? ["Description:", cut(item.description.trim(), DESCRIPTION_MAX)]
      : []),
    "",
    "Acceptance criteria:",
    ...(item.criteria.length > 0
      ? item.criteria.map((criterion) =>
          criterionLine(criterion, input.untickedAt.get(criterion.id)),
        )
      : ["(none: nothing to tick, so say what the new turns did in notes)"]),
    "",
    ...(notes.length > 0
      ? [
          "Notes already on the item, newest last. Do not repeat them:",
          ...notes.map((note) => `- ${note.kind}: ${cut(note.text, 200)}`),
          "",
        ]
      : []),
    `New turns since your last look: ${input.newTurns
      .map((turn) => `turn ${turn.n} (ended ${turn.endedAt})`)
      .join(", ")}.`,
    "",
    "Rules:",
    "1. Tick a criterion only when a new turn shows concrete evidence that it is met: a commit, a test or build result, or command output that proves it. A plan, an intention, or the agent saying it is done is not evidence.",
    "2. Each tick names one new turn in `turn`. Its `evidence` says what in that turn proves the criterion, such as the commit, the test that passed, or the command and its result. Never cite an older turn.",
    "3. When a new turn suggests a criterion is met but the evidence is partial or unclear, do not tick it. Add an `unsure` note with its `criterionId` saying what is missing.",
    "4. Add a `drift` note when the new turns work on something the item and its criteria do not describe.",
    "5. Add at most one `progress` note, a sentence on what the new turns moved forward, and only when they moved something.",
    "6. Never tick a criterion marked ticked. Never tick an unticked one without a new turn that ended after the untick.",
    "7. Keep each note to one or two plain sentences. Use null for `criterionId` when a note is about the whole item.",
    "8. When the new turns moved nothing on the item, return empty `ticks` and `notes`.",
    "",
    "Reply with JSON only, matching the schema you were given.",
    "",
    "The thread:",
    input.digest,
  ].join("\n");
}

/**
 * The commands a run's findings become. Ids are deterministic per run, so a
 * retried run or a resent queued write never applies twice. Ticks that cite a
 * turn the model was not shown as new, or a criterion that is gone or already
 * ticked, are dropped here; the planner still checks everything.
 */
export function stewardCommands(input: {
  readonly findings: StewardFindings;
  readonly item: RoadmapWorkItem;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly newTurns: ReadonlyArray<StewardTurn>;
  /** Identifies this run: the end of the newest turn it read. */
  readonly runKey: string;
}): ReadonlyArray<RoadmapCommand> {
  const { item, threadId, runKey } = input;
  const criteria = new Map(item.criteria.map((criterion) => [criterion.id, criterion]));
  const turnEnds = new Map(input.newTurns.map((turn) => [turn.n, turn.endedAt]));
  const commands: Array<RoadmapCommand> = [];
  const ticked = new Set<string>();
  for (const tick of input.findings.ticks) {
    const criterion = criteria.get(tick.criterionId);
    const endedAt = turnEnds.get(tick.turn);
    const evidence = tick.evidence.trim();
    if (
      criterion === undefined ||
      criterion.tickedAt !== null ||
      endedAt === undefined ||
      evidence.length === 0 ||
      ticked.has(criterion.id)
    ) {
      continue;
    }
    ticked.add(criterion.id);
    commands.push({
      type: "roadmap.criterion.tick",
      commandId: CommandId.make(`steward:tick:${threadId}:${runKey}:${criterion.id}`),
      itemId: item.id,
      criterionId: criterion.id,
      ticked: true,
      evidence: cut(`Turn ${tick.turn} of "${input.threadTitle}": ${evidence}`, TEXT_MAX),
      evidenceAfter: endedAt,
    });
  }
  const notes = input.findings.notes
    .filter((note) => note.text.trim().length > 0)
    .slice(0, NOTES_PER_RUN);
  for (const [index, note] of notes.entries()) {
    const noteId = `steward:${threadId}:${runKey}:${index}`;
    commands.push({
      type: "roadmap.note.add",
      commandId: CommandId.make(`steward:note:${threadId}:${runKey}:${index}`),
      itemId: item.id,
      noteId,
      kind: note.kind,
      text: cut(note.text.trim(), TEXT_MAX),
      // A note about a criterion that is gone still says something about the item.
      criterionId:
        note.criterionId !== null && criteria.has(note.criterionId) ? note.criterionId : null,
    });
  }
  return commands;
}
