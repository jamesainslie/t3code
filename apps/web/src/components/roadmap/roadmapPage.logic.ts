import {
  type CommandId,
  type IsoDate,
  type RoadmapArea,
  type RoadmapCommand,
  type RoadmapCriterionInput,
  RoadmapItemId,
  type RoadmapItemPatch,
  type RoadmapItemState,
  type RoadmapItemType,
  type RoadmapPriority,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { buildTree, type RoadmapTreeNode } from "@lathe/client-runtime/roadmap/tree";
import { canParent, wouldCreateParentCycle } from "@lathe/shared/roadmap";

import { ROADMAP_AREAS, ROADMAP_STATES, ROADMAP_TYPES, workingDaysLeft } from "./roadmap.logic";

export type RoadmapView = "outline" | "board";
/** "open" is every state but done. */
export type RoadmapStateFilter = RoadmapItemState | "open";

export interface RoadmapSearch {
  readonly view?: RoadmapView;
  readonly item?: RoadmapItemId;
  readonly area?: RoadmapArea;
  readonly type?: RoadmapItemType;
  /** Not `state`: search params share one type across routes, and pull requests use `state`. */
  readonly itemState?: RoadmapStateFilter;
  readonly under?: RoadmapItemId;
  /** Opens the item editor; set by "Create work item" in the command palette. */
  readonly new?: 1;
  readonly parent?: RoadmapItemId;
}

const includes = <T extends string>(values: ReadonlyArray<T>, value: unknown): value is T =>
  typeof value === "string" && (values as ReadonlyArray<string>).includes(value);

/** The router parses query values as JSON, so an id can arrive as a number. */
function readItemId(value: unknown): RoadmapItemId | null {
  const text =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return text === "" ? null : RoadmapItemId.make(text.slice(0, 200));
}

export function validateRoadmapSearch(raw: Record<string, unknown>): RoadmapSearch {
  const item = readItemId(raw.item);
  const under = readItemId(raw.under);
  const isNew = raw.new === 1 || raw.new === "1" || raw.new === true || raw.new === "true";
  const parent = isNew ? readItemId(raw.parent) : null;
  return {
    ...(raw.view === "outline" || raw.view === "board" ? { view: raw.view } : {}),
    ...(item === null ? {} : { item }),
    ...(includes(ROADMAP_AREAS, raw.area) ? { area: raw.area } : {}),
    ...(includes(ROADMAP_TYPES, raw.type) ? { type: raw.type } : {}),
    ...(raw.itemState === "open" || includes(ROADMAP_STATES, raw.itemState)
      ? { itemState: raw.itemState }
      : {}),
    ...(under === null ? {} : { under }),
    ...(isNew ? { new: 1 as const } : {}),
    ...(parent === null ? {} : { parent }),
  };
}

/** What the editor should open with when the URL asks for one; an unknown parent becomes a root. */
export function roadmapEditorRequest(
  search: RoadmapSearch,
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
): { readonly parentId: RoadmapItemId | null } | null {
  if (search.new !== 1) return null;
  return {
    parentId: search.parent !== undefined && byId.has(search.parent) ? search.parent : null,
  };
}

export function withoutEditorRequest(search: RoadmapSearch): RoadmapSearch {
  const { new: _new, parent: _parent, ...rest } = search;
  return rest;
}

export type RoadmapFilterKey = "area" | "type" | "itemState";

export function activeRoadmapFilters(search: RoadmapSearch): ReadonlyArray<RoadmapFilterKey> {
  return (["area", "type", "itemState"] as const).filter((key) => search[key] !== undefined);
}

export interface RoadmapOutlineFilter {
  readonly area?: RoadmapArea | undefined;
  readonly type?: RoadmapItemType | undefined;
  readonly state?: RoadmapStateFilter | undefined;
}

/** Matches with their ancestors kept, so each match stays where it sits in the tree. */
export function filterOutlineTree(
  tree: ReadonlyArray<RoadmapTreeNode>,
  filter: RoadmapOutlineFilter,
): ReadonlyArray<RoadmapTreeNode> {
  const { area, type, state } = filter;
  if (area === undefined && type === undefined && state === undefined) return tree;
  const matches = (node: RoadmapTreeNode) =>
    (area === undefined || node.area.area === area) &&
    (type === undefined || node.item.type === type) &&
    (state === undefined ||
      (state === "open" ? node.item.state !== "done" : node.item.state === state));
  const prune = (nodes: ReadonlyArray<RoadmapTreeNode>): ReadonlyArray<RoadmapTreeNode> =>
    nodes.flatMap((node) => {
      const children = prune(node.children);
      return matches(node) || children.length > 0 ? [{ ...node, children }] : [];
    });
  return prune(tree);
}

/** Types an item may take under `parentType` while still holding its current children. */
export function typeOptionsFor(
  parentType: RoadmapItemType | null,
  childTypes: ReadonlyArray<RoadmapItemType>,
): ReadonlyArray<RoadmapItemType> {
  return ROADMAP_TYPES.filter(
    (type) =>
      (parentType === null || canParent(parentType, type)) &&
      childTypes.every((child) => canParent(type, child)),
  );
}

export function defaultTypeFor(parentType: RoadmapItemType | null): RoadmapItemType | null {
  return typeOptionsFor(parentType, [])[0] ?? null;
}

export function canHaveChildren(type: RoadmapItemType): boolean {
  return defaultTypeFor(type) !== null;
}

export interface RoadmapOutlineRow {
  readonly node: RoadmapTreeNode;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

export function flattenOutline(
  tree: ReadonlyArray<RoadmapTreeNode>,
  collapsed: ReadonlySet<RoadmapItemId>,
  expandAll: boolean,
): ReadonlyArray<RoadmapOutlineRow> {
  const rows: Array<RoadmapOutlineRow> = [];
  const walk = (nodes: ReadonlyArray<RoadmapTreeNode>, depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && (expandAll || !collapsed.has(node.item.id));
      rows.push({ node, depth, hasChildren, expanded });
      if (expanded) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

export function ancestorIds(
  itemId: RoadmapItemId,
  byId: ReadonlyMap<RoadmapItemId, Pick<RoadmapWorkItem, "parentId">>,
): ReadonlyArray<RoadmapItemId> {
  const ancestors: Array<RoadmapItemId> = [];
  const seen = new Set<RoadmapItemId>([itemId]);
  let parentId = byId.get(itemId)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId) && byId.has(parentId)) {
    ancestors.push(parentId);
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return ancestors;
}

export type OutlineDropZone = "before" | "inside" | "after";

/** `ratio` is how far down the hovered row the dragged row's centre sits, 0 to 1. */
export function outlineDropZone(ratio: number, canNest: boolean): OutlineDropZone {
  if (!canNest) return ratio < 0.5 ? "before" : "after";
  return ratio < 1 / 3 ? "before" : ratio > 2 / 3 ? "after" : "inside";
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

function acceptsChild(
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
  child: RoadmapWorkItem,
  parentId: RoadmapItemId | null,
): boolean {
  if (parentId === null) return true;
  const parent = byId.get(parentId);
  return (
    parent !== undefined &&
    canParent(parent.type, child.type) &&
    !wouldCreateParentCycle(child.id, parentId, byId)
  );
}

export function canNestInside(
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
  activeId: RoadmapItemId,
  overId: RoadmapItemId,
): boolean {
  const active = byId.get(activeId);
  return active !== undefined && activeId !== overId && acceptsChild(byId, active, overId);
}

export interface OutlineMove {
  readonly parentId: RoadmapItemId | null;
  readonly beforeId?: RoadmapItemId;
  readonly afterId?: RoadmapItemId;
}

/** The `roadmap.item.move` fields for a drop, or null when the drop is invalid or changes nothing. */
export function resolveOutlineDrop(
  items: ReadonlyArray<RoadmapWorkItem>,
  activeId: RoadmapItemId,
  overId: RoadmapItemId,
  zone: OutlineDropZone,
): OutlineMove | null {
  if (activeId === overId) return null;
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const active = byId.get(activeId);
  const over = byId.get(overId);
  if (active === undefined || over === undefined) return null;
  // A parent outside the live set renders as a root, so it moves as one.
  const parentOf = (entry: RoadmapWorkItem) =>
    entry.parentId !== null && byId.has(entry.parentId) ? entry.parentId : null;
  const parentId = zone === "inside" ? over.id : parentOf(over);
  if (!acceptsChild(byId, active, parentId)) return null;
  const siblings = items.filter((entry) => parentOf(entry) === parentId).sort(bySiblingOrder);
  const sameParent = parentOf(active) === parentId;
  if (zone === "inside") {
    return sameParent && siblings.at(-1)?.id === active.id ? null : { parentId };
  }
  const overIndex = siblings.findIndex((entry) => entry.id === over.id);
  const neighbour = siblings[zone === "before" ? overIndex - 1 : overIndex + 1];
  if (sameParent && neighbour?.id === active.id) return null;
  return zone === "before" ? { parentId, beforeId: over.id } : { parentId, afterId: over.id };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatRoadmapDate(iso: IsoDate, today: IsoDate): string {
  const [year, month, day] = iso.split("-");
  const label = `${MONTHS[Number(month) - 1]} ${Number(day)}`;
  return year === today.slice(0, 4) ? label : `${label}, ${year}`;
}

export interface BoardDueLabel {
  readonly date: string | null;
  readonly left: string | null;
  readonly tone: "default" | "soon" | "late" | "done";
}

export function boardDueLabel(
  item: Pick<RoadmapWorkItem, "dueDate" | "state">,
  today: IsoDate,
): BoardDueLabel {
  if (item.dueDate === null) return { date: null, left: null, tone: "default" };
  const date = formatRoadmapDate(item.dueDate, today);
  if (item.state === "done") return { date, left: "done", tone: "done" };
  const days = workingDaysLeft(today, item.dueDate);
  if (days < 0) return { date, left: `${-days} wd late`, tone: "late" };
  if (days === 0) return { date, left: "due today", tone: "soon" };
  return { date, left: `${days} wd`, tone: days <= 1 ? "soon" : "default" };
}

export interface BoardUnderOption {
  readonly id: RoadmapItemId;
  readonly title: string;
  readonly type: RoadmapItemType;
  /** Nesting among the options themselves, for indenting the list. */
  readonly depth: number;
}

/** Objectives and epics in tree order: the items worth narrowing the board to. */
export function boardUnderOptions(
  items: ReadonlyArray<RoadmapWorkItem>,
): ReadonlyArray<BoardUnderOption> {
  const options: Array<BoardUnderOption> = [];
  const walk = (nodes: ReadonlyArray<RoadmapTreeNode>, depth: number) => {
    for (const node of nodes) {
      const included = node.item.type === "objective" || node.item.type === "epic";
      if (included) {
        options.push({ id: node.item.id, title: node.item.title, type: node.item.type, depth });
      }
      walk(node.children, included ? depth + 1 : depth);
    }
  };
  walk(buildTree(items), 0);
  return options;
}

export interface RoadmapEditorDraft {
  readonly type: RoadmapItemType;
  readonly title: string;
  readonly description: string;
  readonly parentId: RoadmapItemId | null;
  /** Null leaves the area to the parent, or to the last root's area for a new root. */
  readonly area: RoadmapArea | null;
  /** Null inherits from the parent. */
  readonly priority: RoadmapPriority | null;
  readonly dueDate: IsoDate | null;
  readonly estimate: number | null;
  /** One criterion per line. */
  readonly criteriaText: string;
}

export function emptyEditorDraft(
  parentId: RoadmapItemId | null,
  parentType: RoadmapItemType | null = null,
): RoadmapEditorDraft {
  return {
    type: defaultTypeFor(parentType) ?? "objective",
    title: "",
    description: "",
    parentId,
    area: null,
    priority: null,
    dueDate: null,
    estimate: null,
    criteriaText: "",
  };
}

export function editorDraftFor(item: RoadmapWorkItem): RoadmapEditorDraft {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    parentId: item.parentId,
    area: item.area,
    priority: item.priority,
    dueDate: item.dueDate,
    estimate: item.estimate,
    criteriaText: item.criteria.map((criterion) => criterion.text).join("\n"),
  };
}

const criteriaLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const MISSING_TITLE = "Give the work item a title.";

type CreateCommand = Extract<RoadmapCommand, { type: "roadmap.item.create" }>;

export function buildCreateCommand(
  draft: RoadmapEditorDraft,
  ids: { readonly itemId: RoadmapItemId; readonly commandId: CommandId },
): { readonly command: CreateCommand } | { readonly error: string } {
  const title = draft.title.trim();
  if (title === "") return { error: MISSING_TITLE };
  const criteria = criteriaLines(draft.criteriaText);
  const description = draft.description.trim();
  return {
    command: {
      type: "roadmap.item.create",
      commandId: ids.commandId,
      itemId: ids.itemId,
      itemType: draft.type,
      title,
      parentId: draft.parentId,
      ...(description === "" ? {} : { description }),
      ...(draft.area === null ? {} : { area: draft.area }),
      ...(draft.priority === null ? {} : { priority: draft.priority }),
      ...(draft.dueDate === null ? {} : { dueDate: draft.dueDate }),
      ...(draft.estimate === null ? {} : { estimate: draft.estimate }),
      ...(criteria.length === 0 ? {} : { criteria: criteria.map((text) => ({ text })) }),
    },
  };
}

/**
 * The commands that turn `item` into `draft`, in dispatch order. When the
 * type and the parent both change, the move goes first if the item's current
 * type already fits the new parent, so neither step is refused midway.
 */
export function buildEditCommands(
  item: RoadmapWorkItem,
  draft: RoadmapEditorDraft,
  nextCommandId: () => CommandId,
  byId?: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
): { readonly commands: ReadonlyArray<RoadmapCommand> } | { readonly error: string } {
  const title = draft.title.trim();
  if (title === "") return { error: MISSING_TITLE };
  const description = draft.description.trim();
  const patch: { -readonly [K in keyof RoadmapItemPatch]: RoadmapItemPatch[K] } = {};
  if (draft.type !== item.type) patch.type = draft.type;
  if (title !== item.title) patch.title = title;
  if (description !== item.description.trim()) patch.description = description;
  if (draft.area !== item.area) patch.area = draft.area;
  if (draft.priority !== item.priority) patch.priority = draft.priority;
  if (draft.dueDate !== item.dueDate) patch.dueDate = draft.dueDate;
  if (draft.estimate !== item.estimate) patch.estimate = draft.estimate;

  const update =
    Object.keys(patch).length === 0
      ? null
      : (commandId: CommandId): RoadmapCommand => ({
          type: "roadmap.item.update",
          commandId,
          itemId: item.id,
          patch,
        });
  const move =
    draft.parentId === item.parentId
      ? null
      : (commandId: CommandId): RoadmapCommand => ({
          type: "roadmap.item.move",
          commandId,
          itemId: item.id,
          parentId: draft.parentId,
        });

  const lines = criteriaLines(draft.criteriaText);
  const unchangedCriteria =
    lines.length === item.criteria.length &&
    lines.every((line, index) => item.criteria[index]?.text === line);
  const unused = [...item.criteria];
  const criteria: Array<RoadmapCriterionInput> = lines.map((text) => {
    // Matching by text keeps a kept criterion's id, and with it its tick.
    const index = unused.findIndex((criterion) => criterion.text === text);
    if (index === -1) return { text };
    const [match] = unused.splice(index, 1);
    return { id: match!.id, text };
  });

  const newParent = draft.parentId === null ? null : (byId?.get(draft.parentId) ?? null);
  const moveFirst =
    update !== null &&
    move !== null &&
    patch.type !== undefined &&
    (draft.parentId === null || (newParent !== null && canParent(newParent.type, item.type)));
  const steps = (moveFirst ? [move, update] : [update, move]).filter((step) => step !== null);
  const commands = steps.map((step) => step(nextCommandId()));
  if (!unchangedCriteria) {
    commands.push({
      type: "roadmap.criteria.set",
      commandId: nextCommandId(),
      itemId: item.id,
      criteria,
    });
  }
  return { commands };
}
