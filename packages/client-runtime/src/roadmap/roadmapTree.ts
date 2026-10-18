/**
 * Fork: pure views over the roadmap stream, shared by web and mobile.
 */
import type {
  RoadmapArea,
  RoadmapExternalBlocker,
  RoadmapItemId,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapPriority,
  RoadmapStreamItem,
  RoadmapThreadRef,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { effectiveArea, effectivePriority } from "@lathe/shared/roadmap";

export interface RoadmapLiveState {
  /** Deltas at or below this were already in the snapshot. */
  readonly snapshotSequence: number;
  /** The latest sequence applied; one event can change several items at the same sequence. */
  readonly sequence: number;
  readonly items: ReadonlyArray<RoadmapWorkItem>;
}

export function applyRoadmapStreamItem(
  state: RoadmapLiveState | null,
  change: RoadmapStreamItem,
): RoadmapLiveState | null {
  if (change.type === "snapshot") {
    return { snapshotSequence: change.sequence, sequence: change.sequence, items: change.items };
  }
  if (state === null || change.sequence <= state.snapshotSequence) return state;
  const sequence = Math.max(state.sequence, change.sequence);
  if (change.type === "item.removed") {
    return {
      ...state,
      sequence,
      items: state.items.filter((item) => item.id !== change.itemId),
    };
  }
  const index = state.items.findIndex((item) => item.id === change.item.id);
  return {
    ...state,
    sequence,
    items:
      index === -1
        ? [...state.items, change.item]
        : state.items.map((item, position) => (position === index ? change.item : item)),
  };
}

export function roadmapItemsById(
  items: ReadonlyArray<RoadmapWorkItem>,
): ReadonlyMap<RoadmapItemId, RoadmapWorkItem> {
  return new Map(items.map((item) => [item.id, item]));
}

const bySiblingOrder = (left: RoadmapWorkItem, right: RoadmapWorkItem) =>
  left.sortKey < right.sortKey
    ? -1
    : left.sortKey > right.sortKey
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;

export interface RoadmapTreeNode {
  readonly item: RoadmapWorkItem;
  readonly priority: { readonly priority: RoadmapPriority; readonly inherited: boolean };
  readonly area: { readonly area: RoadmapArea; readonly inherited: boolean };
  readonly children: ReadonlyArray<RoadmapTreeNode>;
}

/** Roots and their subtrees in sibling order; an item whose parent is missing is a root. */
export function buildTree(items: ReadonlyArray<RoadmapWorkItem>): ReadonlyArray<RoadmapTreeNode> {
  const byId = roadmapItemsById(items);
  const childrenOf = new Map<RoadmapItemId | null, Array<RoadmapWorkItem>>();
  for (const item of items) {
    const parentId = item.parentId !== null && byId.has(item.parentId) ? item.parentId : null;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(item);
    childrenOf.set(parentId, siblings);
  }
  // The sibling arrays are local, so sorting in place is safe; Hermes (mobile) has no toSorted.
  for (const siblings of childrenOf.values()) siblings.sort(bySiblingOrder);
  // Only roots start a walk, so a corrupt parent loop is never reached rather than looping.
  const build = (parentId: RoadmapItemId | null): ReadonlyArray<RoadmapTreeNode> =>
    (childrenOf.get(parentId) ?? []).map((item) => ({
      item,
      priority: effectivePriority(item.id, byId),
      area: effectiveArea(item.id, byId),
      children: build(item.id),
    }));
  return build(null);
}

export interface RoadmapTreeFilter {
  readonly area?: RoadmapArea | null;
  readonly type?: RoadmapItemType | null;
  readonly state?: RoadmapItemState | null;
}

/** Nodes matching every set filter, with their ancestors kept so each match stays in place. */
export function filterTree(
  tree: ReadonlyArray<RoadmapTreeNode>,
  filter: RoadmapTreeFilter,
): ReadonlyArray<RoadmapTreeNode> {
  const { area, type, state } = filter;
  if (area == null && type == null && state == null) return tree;
  const matches = (node: RoadmapTreeNode) =>
    (area == null || node.area.area === area) &&
    (type == null || node.item.type === type) &&
    (state == null || node.item.state === state);
  const prune = (nodes: ReadonlyArray<RoadmapTreeNode>): ReadonlyArray<RoadmapTreeNode> =>
    nodes.flatMap((node) => {
      const children = prune(node.children);
      return matches(node) || children.length > 0 ? [{ ...node, children }] : [];
    });
  return prune(tree);
}

export const ROADMAP_BOARD_STATES: ReadonlyArray<RoadmapItemState> = [
  "backlog",
  "in-progress",
  "in-review",
  "done",
];

const PRIORITY_RANK: Readonly<Record<RoadmapPriority, number>> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/** Descendants of `underId` (every item when null) by state, most urgent first. */
export function boardColumns(
  items: ReadonlyArray<RoadmapWorkItem>,
  options: { readonly underId: RoadmapItemId | null },
): Readonly<Record<RoadmapItemState, ReadonlyArray<RoadmapWorkItem>>> {
  const byId = roadmapItemsById(items);
  const isUnder = (item: RoadmapWorkItem) => {
    if (options.underId === null) return true;
    const seen = new Set<RoadmapItemId>();
    let parentId = item.parentId;
    while (parentId !== null && !seen.has(parentId)) {
      if (parentId === options.underId) return true;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  };
  const ranked = items
    .filter(isUnder)
    .map((item) => ({ item, rank: PRIORITY_RANK[effectivePriority(item.id, byId).priority] }))
    .sort((left, right) => left.rank - right.rank || bySiblingOrder(left.item, right.item));
  const columns: Record<RoadmapItemState, Array<RoadmapWorkItem>> = {
    backlog: [],
    "in-progress": [],
    "in-review": [],
    done: [],
  };
  for (const { item } of ranked) columns[item.state].push(item);
  return columns;
}

export interface RoadmapBlockedState {
  readonly blocked: boolean;
  /** Blocking items that are not done; deleted blockers no longer count. */
  readonly blockers: ReadonlyArray<RoadmapWorkItem>;
  readonly externalBlockers: ReadonlyArray<RoadmapExternalBlocker>;
}

export function blockedState(
  item: RoadmapWorkItem,
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
): RoadmapBlockedState {
  const blockers = item.blockedBy.flatMap((blockerId) => {
    const blocker = byId.get(blockerId);
    return blocker !== undefined && blocker.state !== "done" ? [blocker] : [];
  });
  const externalBlockers = item.externalBlockers.filter((blocker) => blocker.resolvedAt === null);
  return {
    blocked: blockers.length > 0 || externalBlockers.length > 0,
    blockers,
    externalBlockers,
  };
}

export function attachedItemFor(
  items: ReadonlyArray<RoadmapWorkItem>,
  thread: RoadmapThreadRef,
): RoadmapWorkItem | null {
  return (
    items.find((item) =>
      item.attachments.some(
        (attachment) =>
          attachment.thread.environmentId === thread.environmentId &&
          attachment.thread.threadId === thread.threadId,
      ),
    ) ?? null
  );
}
