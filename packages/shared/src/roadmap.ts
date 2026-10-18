/**
 * Fork: pure roadmap rules shared by the server's planner and the clients' views.
 */
import type {
  RoadmapArea,
  RoadmapItemId,
  RoadmapItemType,
  RoadmapPriority,
  RoadmapWorkItem,
} from "@lathe/contracts";

export type RoadmapTreeNodeFields = Pick<
  RoadmapWorkItem,
  "id" | "parentId" | "priority" | "area" | "blockedBy"
>;

type ById<Fields extends keyof RoadmapTreeNodeFields> = ReadonlyMap<
  RoadmapItemId,
  Pick<RoadmapTreeNodeFields, Fields>
>;

export const TYPE_LEVEL: Readonly<Record<RoadmapItemType, number>> = {
  objective: 0,
  "key-result": 1,
  initiative: 2,
  epic: 3,
  feature: 4,
  story: 5,
  bug: 6,
  "support-ticket": 6,
};

const TICKET_PARENTS: ReadonlySet<RoadmapItemType> = new Set(["epic", "feature", "story"]);

export function canParent(parent: RoadmapItemType, child: RoadmapItemType): boolean {
  if (child === "bug" || child === "support-ticket") return TICKET_PARENTS.has(parent);
  return TYPE_LEVEL[parent] < TYPE_LEVEL[child];
}

const DEFAULT_ROADMAP_PRIORITY: RoadmapPriority = "p2";
export const DEFAULT_ROADMAP_AREA: RoadmapArea = "personal";

/** The item and its ancestors, nearest first; stops at a missing parent or a corrupt loop. */
function* ancestry<Fields extends keyof RoadmapTreeNodeFields>(
  itemId: RoadmapItemId,
  byId: ById<"parentId" | Fields>,
): Generator<Pick<RoadmapTreeNodeFields, "parentId" | Fields>> {
  const seen = new Set<RoadmapItemId>();
  let current = byId.get(itemId);
  let currentId: RoadmapItemId | null = itemId;
  while (current !== undefined && currentId !== null && !seen.has(currentId)) {
    seen.add(currentId);
    yield current;
    currentId = current.parentId;
    current = currentId === null ? undefined : byId.get(currentId);
  }
}

export function effectivePriority(
  itemId: RoadmapItemId,
  byId: ById<"parentId" | "priority">,
): { readonly priority: RoadmapPriority; readonly inherited: boolean } {
  let inherited = false;
  for (const node of ancestry(itemId, byId)) {
    if (node.priority !== null) return { priority: node.priority, inherited };
    inherited = true;
  }
  return { priority: DEFAULT_ROADMAP_PRIORITY, inherited: true };
}

export function effectiveArea(
  itemId: RoadmapItemId,
  byId: ById<"parentId" | "area">,
): { readonly area: RoadmapArea; readonly inherited: boolean } {
  let inherited = false;
  for (const node of ancestry(itemId, byId)) {
    if (node.area !== null) return { area: node.area, inherited };
    inherited = true;
  }
  return { area: DEFAULT_ROADMAP_AREA, inherited: true };
}

export function wouldCreateParentCycle(
  itemId: RoadmapItemId,
  newParentId: RoadmapItemId | null,
  byId: ById<"parentId">,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === itemId) return true;
  for (const ancestor of ancestry(newParentId, byId)) {
    if (ancestor.parentId === itemId) return true;
  }
  return false;
}

export function wouldCreateBlockerCycle(
  itemId: RoadmapItemId,
  blockedById: RoadmapItemId,
  byId: ById<"blockedBy">,
): boolean {
  const seen = new Set<RoadmapItemId>();
  const pending = [blockedById];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (next === itemId) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    pending.push(...(byId.get(next)?.blockedBy ?? []));
  }
  return false;
}

const DIGITS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Midpoint of two digit strings read as fractions in (0, 1); "" is the open
 * bound on either side. Same scheme as the client's pinned-thread order keys,
 * which the server cannot import.
 */
function midpoint(a: string, b: string): string {
  if (b !== "") {
    let n = 0;
    while ((a.charAt(n) || DIGITS[0]) === b.charAt(n)) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a === "" ? 0 : DIGITS.indexOf(a.charAt(0));
  const digitB = b === "" ? DIGITS.length : DIGITS.indexOf(b.charAt(0));
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  if (b.length > 1) return b.charAt(0);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), "");
}

/**
 * A sibling order key strictly between `before` and `after`; null is the open
 * end. An `after` that does not sort above `before` is ignored, so a corrupt
 * neighbour degrades to an append rather than a failure.
 */
export function sortKeyBetween(before: string | null, after: string | null): string {
  const a = before ?? "";
  const b = after !== null && after > a ? after : "";
  return midpoint(a, b);
}
