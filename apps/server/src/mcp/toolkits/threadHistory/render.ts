import type { OrchestrationCheckpointFile, ThreadId } from "@t3tools/contracts";

import {
  DIGEST_LIMITS,
  type DigestTurnDetail,
  type DigestTurnSummary,
  type ThreadDigest,
} from "./digest.ts";
import { cutToBytes } from "./text.ts";

// Rendering of thread digests as tagged text for an agent. Every function returns text that
// stays within `DIGEST_LIMITS.budgetBytes` (or the budget given), as long as that budget can
// hold the header and the newest turn's user text and files.

/** A changed-files list longer than this ends with a count of the files left out. */
const FILES_BYTES = 300;
const MORE_HINT = "read_thread_turns(threadId, beforeTurn) returns earlier turns in full.";
const CLOSE = "</thread>";

const ELEMENTS = [
  "thread",
  "goal",
  "steering",
  "user",
  "open_work",
  "todo",
  "plan",
  "comment",
  "pr",
  "earlier_turns",
  "recent_turns",
  "turn",
  "assistant",
  "tools",
  "files",
  "errors",
  "more",
];
const CLOSING_TAG = new RegExp(`</(?=\\s*(?:${ELEMENTS.join("|")})\\b)`, "gi");

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);

/** Neutralizes closing tags of digest elements so a message body cannot end its element. */
export function escapeBody(text: string): string {
  return text.replace(CLOSING_TAG, "<\\/");
}

const escapeAttr = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** Renders ` key="value"` pairs in order, skipping null and undefined values. */
function attrs(values: Record<string, string | number | null | undefined>): string {
  return Object.entries(values)
    .flatMap(([key, value]) =>
      value === null || value === undefined ? [] : [` ${key}="${escapeAttr(String(value))}"`],
    )
    .join("");
}

const cutAttr = (value: string | null) =>
  value === null ? null : cutToBytes(value, DIGEST_LIMITS.excerptBytes);

/** How many leading sizes fit within `maxBytes`, stopping at the first that does not. */
function fitCount(sizes: ReadonlyArray<number>, maxBytes: number): number {
  let used = 0;
  let count = 0;
  for (const size of sizes) {
    if (used + size > maxBytes) break;
    used += size;
    count += 1;
  }
  return count;
}

/** A list element whose lines each end in a newline, noting how many lines were left out. */
function listSection(name: string, lines: ReadonlyArray<string>, omitted: number): string {
  if (lines.length === 0 && omitted === 0) return "";
  const open = `<${name}${attrs({ omitted: omitted > 0 ? omitted : null })}`;
  if (lines.length === 0) return `${open}/>\n`;
  return `${open}>\n${lines.join("")}</${name}>\n`;
}

/**
 * Renders a list section within `room` bytes, keeping its first or last lines and marking the
 * rest as omitted. Returns "" when not even the omitted marker fits.
 */
function fitSection(
  name: string,
  lines: ReadonlyArray<string>,
  room: number,
  keep: "first" | "last",
): string {
  const full = listSection(name, lines, 0);
  if (bytes(full) <= room) return full;
  const wrapper = bytes(listSection(name, [""], lines.length));
  const sizes = lines.map(bytes);
  const count = fitCount(keep === "first" ? sizes : sizes.toReversed(), room - wrapper);
  const kept = keep === "first" ? lines.slice(0, count) : lines.slice(lines.length - count);
  const text = listSection(name, kept, lines.length - count);
  return bytes(text) <= room ? text : "";
}

const fileText = (file: OrchestrationCheckpointFile) =>
  `${file.path} +${file.additions} -${file.deletions}`;

function filesText(files: ReadonlyArray<OrchestrationCheckpointFile>): string {
  const parts = files.map(fileText);
  const joined = parts.join(", ");
  if (bytes(joined) <= FILES_BYTES) return joined;
  const kept = fitCount(
    parts.map((part, index) => bytes(part) + (index > 0 ? 2 : 0)),
    FILES_BYTES,
  );
  const more = `${parts.length - kept} more files`;
  return kept === 0 ? more : `${parts.slice(0, kept).join(", ")}, ${more}`;
}

function renderHeader(header: ThreadDigest["header"]): string {
  const { status } = header;
  return `<thread${attrs({
    id: header.threadId,
    title: cutAttr(header.title),
    project: cutAttr(header.projectTitle),
    provider: cutAttr(header.provider),
    model: cutAttr(header.model),
    branch: cutAttr(header.branch),
    worktree: header.worktreeRelation === "none" ? null : header.worktreeRelation,
    worktree_path: cutAttr(header.worktreePath),
    created: header.createdAt,
    last_activity: header.lastActivityAt,
    status: status.kind,
    error: status.kind === "error" ? status.message : null,
    used_tokens: status.kind === "context-full" ? status.usedTokens : null,
    max_tokens: status.kind === "context-full" ? status.maxTokens : null,
  })}>\n`;
}

function renderGoal(goal: string, room: number): string {
  const body = escapeBody(goal);
  const wrapper = bytes("<goal></goal>\n");
  const fitted = bytes(body) + wrapper <= room ? body : cutToBytes(body, room - wrapper);
  return `<goal>${fitted}</goal>\n`;
}

function openWorkLines(openWork: ThreadDigest["openWork"]): ReadonlyArray<string> {
  return [
    ...openWork.todos.map((todo) => `<todo>${escapeBody(todo)}</todo>\n`),
    ...openWork.plans.map(
      (plan) => `<plan${attrs({ id: plan.id })}>${escapeBody(plan.excerpt)}</plan>\n`,
    ),
    ...openWork.comments.map(
      (comment) =>
        `<comment${attrs({ file: cutAttr(comment.file) })}>${escapeBody(comment.text)}</comment>\n`,
    ),
    ...openWork.pullRequests.map(
      (pr) => `<pr${attrs({ n: pr.number, state: pr.state })}>${escapeBody(pr.url)}</pr>\n`,
    ),
  ];
}

function renderSummary(turn: DigestTurnSummary, degraded = false): string {
  const attributes = attrs({
    n: turn.n,
    state: turn.state,
    files: turn.files.length > 0 ? filesText(turn.files) : null,
    summary: degraded ? "true" : null,
  });
  return turn.outcome.length > 0
    ? `<turn${attributes}>${escapeBody(turn.outcome)}</turn>\n`
    : `<turn${attributes}/>\n`;
}

/** A recent turn in earlier-turn form, used when the budget cannot hold it in detail. */
const summaryOf = (turn: DigestTurnDetail): DigestTurnSummary => ({
  n: turn.n,
  state: turn.state,
  outcome: cutToBytes(
    turn.assistant.at(-1) ?? turn.errors.at(-1) ?? "",
    DIGEST_LIMITS.earlierTurnBytes,
  ),
  files: turn.files,
});

/**
 * A turn in full. Given a `room` it cannot fill, it keeps the user text and files and fits the
 * newest assistant messages, then errors, then tool calls, into what is left.
 */
function renderDetail(turn: DigestTurnDetail, room = Number.POSITIVE_INFINITY): string {
  const open = `<turn${attrs({ n: turn.n, state: turn.state })}>\n`;
  const user = turn.user.length > 0 ? `<user>${escapeBody(turn.user)}</user>\n` : "";
  const files =
    turn.files.length > 0 ? `<files>${escapeBody(filesText(turn.files))}</files>\n` : "";
  const close = "</turn>\n";
  const assistant = turn.assistant.map((text) => `<assistant>${escapeBody(text)}</assistant>\n`);
  const tools = turn.tools.map((line) => `${escapeBody(line)}\n`);
  const errors = turn.errors.map((line) => `${escapeBody(line)}\n`);

  const full = [
    open,
    user,
    ...assistant,
    listSection("tools", tools, 0),
    files,
    listSection("errors", errors, 0),
    close,
  ].join("");
  if (bytes(full) <= room) return full;

  let left = room - bytes(open) - bytes(user) - bytes(files) - bytes(close);
  const marker = (omitted: number) => `<assistant${attrs({ omitted })}/>\n`;
  const markerBound = assistant.length > 0 ? bytes(marker(assistant.length)) : 0;
  const whole = fitCount(assistant.map(bytes).toReversed(), left - markerBound);
  let kept = assistant.slice(assistant.length - whole);
  // When not even the final reply fits whole, it is cut to the space left.
  const finalReply = turn.assistant.at(-1);
  if (whole === 0 && finalReply !== undefined) {
    const wrapper = bytes("<assistant></assistant>\n");
    const cut = cutToBytes(escapeBody(finalReply), left - markerBound - wrapper);
    if (cut.length > 0) kept = [`<assistant>${cut}</assistant>\n`];
  }
  const omitted = assistant.length - kept.length;
  const keptAssistant = omitted > 0 && left >= markerBound ? [marker(omitted), ...kept] : kept;
  left -= sum(keptAssistant.map(bytes));
  const errorSection = fitSection("errors", errors, left, "last");
  left -= bytes(errorSection);
  const toolSection = fitSection("tools", tools, left, "last");
  return [open, user, ...keptAssistant, toolSection, files, errorSection, close].join("");
}

function renderMore(beforeTurn: number, omittedTurns: number): string {
  return `<more${attrs({ before_turn: beforeTurn, omitted_turns: omittedTurns })}/>\n${MORE_HINT}\n`;
}

interface PlacedTurns {
  readonly text: string;
  /** Turn number of the oldest rendered turn, or the next turn number when none was. */
  readonly beforeTurn: number;
  readonly rendered: number;
}

/**
 * Places recent turns, then earlier turns, within `room`. The oldest recent turns degrade to
 * summary form one at a time until the rest fit, and the newest is always rendered in detail.
 * Earlier turns fill what is left newest first, so the rendered turns are always a contiguous
 * run ending at the newest.
 */
function placeTurns(
  earlierTurns: ReadonlyArray<DigestTurnSummary>,
  recentTurns: ReadonlyArray<DigestTurnDetail>,
  room: number,
  nextTurn: number,
): PlacedTurns {
  const recentOpen = "<recent_turns>\n";
  const recentClose = "</recent_turns>\n";
  const recentWrapper = recentTurns.length > 0 ? bytes(recentOpen + recentClose) : 0;
  const details = recentTurns.map((turn) => renderDetail(turn));
  const summaries = recentTurns.map((turn) => renderSummary(summaryOf(turn), true));
  const detailSizes = details.map(bytes);
  const summarySizes = summaries.map(bytes);
  const count = recentTurns.length;
  const recentSize = (detailed: number) =>
    recentWrapper +
    sum(summarySizes.slice(0, count - detailed)) +
    sum(detailSizes.slice(count - detailed));

  let detailed = count;
  while (detailed > 1 && recentSize(detailed) > room) detailed -= 1;

  let recentLines: ReadonlyArray<string> = [];
  const newest = recentTurns.at(-1);
  if (newest !== undefined) {
    if (recentSize(detailed) <= room) {
      recentLines = [...summaries.slice(0, count - detailed), ...details.slice(count - detailed)];
    } else {
      // Only the newest turn is left in detail: drop degraded turns oldest first, then cut it.
      const newestRoom = room - recentWrapper;
      const newestDetail = details.at(-1)!;
      const newestSize = detailSizes.at(-1)!;
      if (newestSize <= newestRoom) {
        const kept = fitCount(summarySizes.slice(0, -1).toReversed(), newestRoom - newestSize);
        recentLines = [...summaries.slice(count - 1 - kept, -1), newestDetail];
      } else {
        recentLines = [renderDetail(newest, newestRoom)];
      }
    }
  }
  const recentText = newest === undefined ? "" : recentOpen + recentLines.join("") + recentClose;

  const earlierOpen = "<earlier_turns>\n";
  const earlierClose = "</earlier_turns>\n";
  const earlierLines = earlierTurns.map((turn) => renderSummary(turn));
  const earlierKept =
    recentLines.length === count
      ? fitCount(
          earlierLines.map(bytes).toReversed(),
          room - bytes(recentText) - bytes(earlierOpen + earlierClose),
        )
      : 0;
  const earlierText =
    earlierKept > 0
      ? earlierOpen + earlierLines.slice(earlierLines.length - earlierKept).join("") + earlierClose
      : "";

  const oldestRecent = recentTurns[count - recentLines.length];
  const beforeTurn =
    earlierKept > 0
      ? earlierTurns[earlierTurns.length - earlierKept]!.n
      : (oldestRecent?.n ?? nextTurn);
  return {
    text: earlierText + recentText,
    beforeTurn,
    rendered: earlierKept + recentLines.length,
  };
}

/**
 * Renders a digest as tagged text within `budgetBytes`. Header, goal, open work, and steering
 * are placed first (steering drops its oldest messages if they do not fit), leaving room for
 * the newest turn's user text and files; turns share the rest.
 */
export function renderThreadDigest(
  digest: ThreadDigest,
  budgetBytes: number = DIGEST_LIMITS.budgetBytes,
): string {
  const { earlierTurns, recentTurns } = digest;
  const turnCount = earlierTurns.length + recentTurns.length;
  const nextTurn = (recentTurns.at(-1)?.n ?? earlierTurns.at(-1)?.n ?? 0) + 1;
  const header = renderHeader(digest.header);
  // Counts in the closing marker are known only once turns are placed; reserve the largest.
  const tailBound = bytes(renderMore(nextTurn, turnCount) + CLOSE);
  const newest = recentTurns.at(-1);
  const newestFloor =
    newest === undefined ? 0 : bytes("<recent_turns>\n</recent_turns>\n" + renderDetail(newest, 0));

  let room = budgetBytes - bytes(header) - tailBound - newestFloor;
  const goal = digest.goal === null ? "" : renderGoal(digest.goal, room);
  room -= bytes(goal);
  const openWork = fitSection("open_work", openWorkLines(digest.openWork), room, "first");
  room -= bytes(openWork);
  const steering = fitSection(
    "steering",
    digest.steering.map(
      (entry) => `<user${attrs({ turn: entry.turn })}>${escapeBody(entry.text)}</user>\n`,
    ),
    room,
    "last",
  );
  room -= bytes(steering);

  const turns = placeTurns(earlierTurns, recentTurns, room + newestFloor, nextTurn);
  const omitted = turnCount - turns.rendered;
  const more = omitted > 0 ? renderMore(turns.beforeTurn, omitted) : "";
  return header + goal + steering + openWork + turns.text + more + CLOSE;
}

/**
 * Renders a page of turns in full for `read_thread_turns`. The newest turn is always kept; older
 * ones that do not fit the budget are dropped and counted with the `olderTurns` before them.
 */
export function renderTurnDetails(
  threadId: ThreadId,
  turns: ReadonlyArray<DigestTurnDetail>,
  olderTurns: number,
): string {
  const header = `<thread${attrs({ id: threadId })}>\n`;
  const nextTurn = (turns.at(-1)?.n ?? olderTurns) + 1;
  const tailBound = bytes(renderMore(nextTurn, olderTurns + turns.length) + CLOSE);
  const room = DIGEST_LIMITS.budgetBytes - bytes(header) - tailBound;

  const details = turns.map((turn) => renderDetail(turn));
  const sizes = details.map(bytes).toReversed();
  const newest = turns.at(-1);
  let kept: ReadonlyArray<string> = [];
  if (newest !== undefined) {
    kept =
      sizes[0]! <= room
        ? details.slice(details.length - fitCount(sizes, room))
        : [renderDetail(newest, room)];
  }

  const omitted = olderTurns + turns.length - kept.length;
  const beforeTurn = turns[turns.length - kept.length]?.n ?? nextTurn;
  const more = omitted > 0 ? renderMore(beforeTurn, omitted) : "";
  return header + kept.join("") + more + CLOSE;
}

/** One line per matching thread for `find_threads`. */
export function renderThreadMatches(
  matches: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly title: string;
    readonly projectTitle: string | null;
    readonly branch: string | null;
    readonly lastActivityAt: string;
    readonly status: string;
  }>,
): string {
  if (matches.length === 0) return "No threads matched.";
  return matches
    .map(
      (match) =>
        `<thread${attrs({
          id: match.threadId,
          title: cutAttr(match.title),
          project: cutAttr(match.projectTitle),
          branch: cutAttr(match.branch),
          last_activity: match.lastActivityAt,
          status: match.status,
        })}/>`,
    )
    .join("\n");
}
