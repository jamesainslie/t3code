/**
 * Fork: roadmap. Pure helpers for the thread-side entry points: the thread
 * menu, the attach picker and the Roadmap card.
 */
import {
  RoadmapItemType,
  type RoadmapItemId,
  type RoadmapPriority,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { buildTree, type RoadmapTreeNode } from "@lathe/client-runtime/roadmap/tree";

export const ROADMAP_ITEM_TYPE_LABELS: Readonly<Record<RoadmapItemType, string>> = {
  objective: "Objective",
  "key-result": "Key Result",
  initiative: "Initiative",
  epic: "Epic",
  feature: "Feature",
  story: "Story",
  bug: "Bug",
  "support-ticket": "Support ticket",
};

/** Hierarchy order, which is also the order the create menus list them in. */
export const ROADMAP_ITEM_TYPES: ReadonlyArray<RoadmapItemType> = RoadmapItemType.literals;

/**
 * A link into the Roadmap page. The page owns these search params: `item`
 * selects an item, `new` opens the editor, `parent` preselects its parent.
 */
export function roadmapHref(
  target: {
    readonly item?: RoadmapItemId;
    readonly new?: boolean;
    readonly parent?: RoadmapItemId | null;
  } = {},
): string {
  const params = new URLSearchParams();
  if (target.item !== undefined) params.set("item", target.item);
  if (target.new) params.set("new", "1");
  if (target.new && target.parent) params.set("parent", target.parent);
  const query = params.toString();
  return query.length > 0 ? `/roadmap?${query}` : "/roadmap";
}

export interface AttachPickerEntry {
  readonly item: RoadmapWorkItem;
  /** Levels below the top of its tree. */
  readonly depth: number;
  /** Ancestor titles from the top of the tree down. */
  readonly path: ReadonlyArray<string>;
  readonly priority: RoadmapTreeNode["priority"];
}

export interface AttachPickerGroup {
  /** The objective's id, or null for the items under no objective. */
  readonly objectiveId: RoadmapItemId | null;
  readonly label: string;
  readonly entries: ReadonlyArray<AttachPickerEntry>;
}

const sameThread = (left: RoadmapThreadRef, right: RoadmapThreadRef) =>
  left.environmentId === right.environmentId && left.threadId === right.threadId;

/**
 * Every work item a thread can attach to, grouped by the objective at the
 * top of its tree. Trees with no objective at the top share one last group.
 */
export function attachPickerGroups(
  items: ReadonlyArray<RoadmapWorkItem>,
  options: { readonly excludeAttachedTo?: RoadmapThreadRef } = {},
): ReadonlyArray<AttachPickerGroup> {
  const { excludeAttachedTo } = options;
  const keep = (item: RoadmapWorkItem) =>
    excludeAttachedTo === undefined ||
    !item.attachments.some((attachment) => sameThread(attachment.thread, excludeAttachedTo));
  const flatten = (node: RoadmapTreeNode, path: ReadonlyArray<string>): AttachPickerEntry[] => [
    ...(keep(node.item)
      ? [{ item: node.item, depth: path.length, path, priority: node.priority }]
      : []),
    ...node.children.flatMap((child) => flatten(child, [...path, node.item.title])),
  ];
  const groups: AttachPickerGroup[] = [];
  const loose: AttachPickerEntry[] = [];
  for (const root of buildTree(items)) {
    if (root.item.type === "objective") {
      const entries = flatten(root, []);
      if (entries.length > 0) {
        groups.push({ objectiveId: root.item.id, label: root.item.title, entries });
      }
    } else {
      loose.push(...flatten(root, []));
    }
  }
  if (loose.length > 0) groups.push({ objectiveId: null, label: "No objective", entries: loose });
  return groups;
}

export const ROADMAP_PRIORITY_LABELS: Readonly<Record<RoadmapPriority, string>> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
};
