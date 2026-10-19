import {
  type CommandId,
  type IsoDate,
  type RoadmapArea,
  type RoadmapAreasSettings,
  type RoadmapCommand,
  type RoadmapCriterionInput,
  RoadmapItemId,
  type RoadmapItemPatch,
  type RoadmapItemState,
  type RoadmapItemType,
  type RoadmapPriority,
  type RoadmapSprint,
  RoadmapSprintId,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import { buildTree, type RoadmapTreeNode } from "@lathe/client-runtime/roadmap/tree";
import { canParent, effectiveArea, wouldCreateParentCycle } from "@lathe/shared/roadmap";
import {
  forecast,
  localDateOf,
  type RoadmapDateOf,
  type RoadmapForecast,
  type RoadmapForecastStatus,
  type RoadmapItemsById,
  type RoadmapVelocity,
  velocity,
} from "@lathe/shared/roadmapCalc";

import { ROADMAP_AREAS, ROADMAP_STATES, ROADMAP_TYPES, workingDaysLeft } from "./roadmap.logic";

export const ROADMAP_VIEWS = ["today", "outline", "timeline", "board"] as const;
export type RoadmapView = (typeof ROADMAP_VIEWS)[number];
/** The view Roadmap opens on; its URL carries no `view`. */
export const DEFAULT_ROADMAP_VIEW: RoadmapView = "today";

export const roadmapViewOf = (search: RoadmapSearch): RoadmapView =>
  search.view ?? DEFAULT_ROADMAP_VIEW;
/** "open" is every state but done. */
export type RoadmapStateFilter = RoadmapItemState | "open";

export const OUTLINE_LEVELS = ["epic", "feature", "story"] as const;
export type RoadmapOutlineLevel = (typeof OUTLINE_LEVELS)[number];
/** "none" is items in no sprint. */
export type RoadmapSprintFilter = RoadmapSprintId | "none";

export interface RoadmapSearch {
  readonly view?: RoadmapView;
  readonly item?: RoadmapItemId;
  readonly area?: RoadmapArea;
  readonly type?: RoadmapItemType;
  /** Not `state`: search params share one type across routes, and pull requests use `state`. */
  readonly itemState?: RoadmapStateFilter;
  readonly under?: RoadmapItemId;
  readonly sprint?: RoadmapSprintFilter;
  /** Outline layout: the items of this type become the roots. */
  readonly level?: RoadmapOutlineLevel;
  /** Outline layout: only the focused items and what sits under them. */
  readonly focus?: 1;
  /** Opens the item editor; set by "Create work item" in the command palette. */
  readonly new?: 1;
  readonly parent?: RoadmapItemId;
  /** Opens the GitHub import dialog; set by "Import GitHub issue" in the command palette. */
  readonly import?: 1;
}

const includes = <T extends string>(values: ReadonlyArray<T>, value: unknown): value is T =>
  typeof value === "string" && (values as ReadonlyArray<string>).includes(value);

/** The router parses query values as JSON, so an id can arrive as a number. */
function readId(value: unknown): string | null {
  const text =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return text === "" ? null : text.slice(0, 200);
}

function readItemId(value: unknown): RoadmapItemId | null {
  const text = readId(value);
  return text === null ? null : RoadmapItemId.make(text);
}

function readSprintFilter(value: unknown): RoadmapSprintFilter | null {
  const text = readId(value);
  return text === null ? null : text === "none" ? "none" : RoadmapSprintId.make(text);
}

/** The router parses query values as JSON, so a flag can arrive as a number or a boolean. */
const isOn = (value: unknown) => value === 1 || value === "1" || value === true || value === "true";

export function validateRoadmapSearch(raw: Record<string, unknown>): RoadmapSearch {
  const item = readItemId(raw.item);
  const under = readItemId(raw.under);
  const isNew = isOn(raw.new);
  const parent = isNew ? readItemId(raw.parent) : null;
  const sprint = readSprintFilter(raw.sprint);
  return {
    ...(includes(ROADMAP_VIEWS, raw.view) ? { view: raw.view } : {}),
    ...(item === null ? {} : { item }),
    ...(includes(ROADMAP_AREAS, raw.area) ? { area: raw.area } : {}),
    ...(includes(ROADMAP_TYPES, raw.type) ? { type: raw.type } : {}),
    ...(raw.itemState === "open" || includes(ROADMAP_STATES, raw.itemState)
      ? { itemState: raw.itemState }
      : {}),
    ...(under === null ? {} : { under }),
    ...(sprint === null ? {} : { sprint }),
    ...(includes(OUTLINE_LEVELS, raw.level) ? { level: raw.level } : {}),
    ...(isOn(raw.focus) ? { focus: 1 as const } : {}),
    ...(isNew ? { new: 1 as const } : {}),
    ...(parent === null ? {} : { parent }),
    ...(isOn(raw.import) ? { import: 1 as const } : {}),
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
  const { new: _new, parent: _parent, import: _import, ...rest } = search;
  return rest;
}

export type RoadmapFilterKey = "area" | "type" | "itemState" | "sprint";

export function activeRoadmapFilters(search: RoadmapSearch): ReadonlyArray<RoadmapFilterKey> {
  return (["area", "type", "itemState", "sprint"] as const).filter(
    (key) => search[key] !== undefined,
  );
}

/** The URL's sprint filter, unless it names a sprint since deleted, which shows everything. */
export function knownSprintFilter(
  search: RoadmapSearch,
  sprints: ReadonlyArray<RoadmapSprint>,
): RoadmapSprintFilter | undefined {
  const { sprint } = search;
  if (sprint === undefined || sprint === "none") return sprint;
  return sprints.some((entry) => entry.id === sprint) ? sprint : undefined;
}

export interface RoadmapOutlineFilter {
  readonly area?: RoadmapArea | undefined;
  readonly type?: RoadmapItemType | undefined;
  readonly state?: RoadmapStateFilter | undefined;
  readonly sprint?: RoadmapSprintFilter | undefined;
}

const isOutlineFiltered = (filter: RoadmapOutlineFilter): boolean =>
  filter.area !== undefined ||
  filter.type !== undefined ||
  filter.state !== undefined ||
  filter.sprint !== undefined;

/** Matches with their ancestors kept, so each match stays where it sits in the tree. */
export function filterOutlineTree(
  tree: ReadonlyArray<RoadmapTreeNode>,
  filter: RoadmapOutlineFilter,
): ReadonlyArray<RoadmapTreeNode> {
  const { area, type, state, sprint } = filter;
  if (!isOutlineFiltered(filter)) return tree;
  const matches = (node: RoadmapTreeNode) =>
    (area === undefined || node.area.area === area) &&
    (type === undefined || node.item.type === type) &&
    (state === undefined ||
      (state === "open" ? node.item.state !== "done" : node.item.state === state)) &&
    (sprint === undefined || node.item.sprintId === (sprint === "none" ? null : sprint));
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
): ReadonlyArray<RoadmapOutlineRow> {
  const rows: Array<RoadmapOutlineRow> = [];
  const walk = (nodes: ReadonlyArray<RoadmapTreeNode>, depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && !collapsed.has(node.item.id);
      rows.push({ node, depth, hasChildren, expanded });
      if (expanded) walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

export interface RoadmapOutlineLayout {
  readonly level?: RoadmapOutlineLevel | undefined;
  readonly focus?: boolean | undefined;
}

/**
 * The Outline's roots under a layout. Focus narrows to the topmost focused items,
 * then a level re-roots at the topmost items of that type within them. Each root
 * keeps its whole subtree; anything above or outside a root is left out.
 */
export function outlineRoots(
  tree: ReadonlyArray<RoadmapTreeNode>,
  layout: RoadmapOutlineLayout,
): ReadonlyArray<RoadmapTreeNode> {
  const topmost = (
    nodes: ReadonlyArray<RoadmapTreeNode>,
    isRoot: (node: RoadmapTreeNode) => boolean,
  ): ReadonlyArray<RoadmapTreeNode> =>
    nodes.flatMap((node) => (isRoot(node) ? [node] : topmost(node.children, isRoot)));
  const { level, focus } = layout;
  const focused = focus ? topmost(tree, (node) => node.item.focusedAt !== null) : tree;
  return level === undefined ? focused : topmost(focused, (node) => node.item.type === level);
}

/** Changes that make the focus set exactly `selected`. */
export function focusChanges(
  items: ReadonlyArray<RoadmapWorkItem>,
  selected: ReadonlySet<RoadmapItemId>,
): {
  readonly focus: ReadonlyArray<RoadmapItemId>;
  readonly unfocus: ReadonlyArray<RoadmapItemId>;
} {
  return {
    focus: items
      .filter((item) => item.focusedAt === null && selected.has(item.id))
      .map((item) => item.id),
    unfocus: items
      .filter((item) => item.focusedAt !== null && !selected.has(item.id))
      .map((item) => item.id),
  };
}

/** Every item in the tree that has children, which is what Collapse all collapses. */
export function expandableIds(tree: ReadonlyArray<RoadmapTreeNode>): ReadonlySet<RoadmapItemId> {
  const ids = new Set<RoadmapItemId>();
  const walk = (nodes: ReadonlyArray<RoadmapTreeNode>) => {
    for (const node of nodes) {
      if (node.children.length === 0) continue;
      ids.add(node.item.id);
      walk(node.children);
    }
  };
  walk(tree);
  return ids;
}

export function allCollapsed(
  tree: ReadonlyArray<RoadmapTreeNode>,
  collapsed: ReadonlySet<RoadmapItemId>,
): boolean {
  const ids = expandableIds(tree);
  return ids.size > 0 && [...ids].every((itemId) => collapsed.has(itemId));
}

/** Collapse all and Expand all touch only the rows in view, so other layouts keep theirs. */
export function collapseAllIn(
  collapsed: ReadonlySet<RoadmapItemId>,
  tree: ReadonlyArray<RoadmapTreeNode>,
): ReadonlySet<RoadmapItemId> {
  return new Set([...collapsed, ...expandableIds(tree)]);
}

export function expandAllIn(
  collapsed: ReadonlySet<RoadmapItemId>,
  tree: ReadonlyArray<RoadmapTreeNode>,
): ReadonlySet<RoadmapItemId> {
  const inView = expandableIds(tree);
  return new Set([...collapsed].filter((itemId) => !inView.has(itemId)));
}

/**
 * A filtered outline opens fully so every match shows, and keeps its own collapse state
 * until the filter changes. The saved state belongs to the unfiltered outline only.
 */
export interface RoadmapOutlineCollapse {
  readonly saved: ReadonlySet<RoadmapItemId>;
  readonly filtered: {
    readonly key: string;
    readonly collapsed: ReadonlySet<RoadmapItemId>;
  } | null;
}

const NOTHING_COLLAPSED: ReadonlySet<RoadmapItemId> = new Set();

export const outlineFilterKey = (filter: RoadmapOutlineFilter): string | null =>
  isOutlineFiltered(filter)
    ? JSON.stringify([filter.area, filter.type, filter.state, filter.sprint])
    : null;

export const initialOutlineCollapse = (
  saved: ReadonlySet<RoadmapItemId>,
): RoadmapOutlineCollapse => ({ saved, filtered: null });

export function activeCollapsed(
  state: RoadmapOutlineCollapse,
  filterKey: string | null,
): ReadonlySet<RoadmapItemId> {
  if (filterKey === null) return state.saved;
  return state.filtered?.key === filterKey ? state.filtered.collapsed : NOTHING_COLLAPSED;
}

export function updateOutlineCollapse(
  state: RoadmapOutlineCollapse,
  filterKey: string | null,
  update: (current: ReadonlySet<RoadmapItemId>) => ReadonlySet<RoadmapItemId>,
): RoadmapOutlineCollapse {
  const collapsed = update(activeCollapsed(state, filterKey));
  return filterKey === null
    ? { ...state, saved: collapsed }
    : { ...state, filtered: { key: filterKey, collapsed } };
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

/** `weekdays` is the item's area calendar. */
export function boardDueLabel(
  item: Pick<RoadmapWorkItem, "dueDate" | "state">,
  today: IsoDate,
  weekdays?: ReadonlyArray<number>,
): BoardDueLabel {
  if (item.dueDate === null) return { date: null, left: null, tone: "default" };
  const date = formatRoadmapDate(item.dueDate, today);
  if (item.state === "done") return { date, left: "done", tone: "done" };
  const days = workingDaysLeft(today, item.dueDate, weekdays);
  if (days < 0) return { date, left: `${-days} wd late`, tone: "late" };
  if (days === 0) return { date, left: "due today", tone: "soon" };
  return { date, left: `${days} wd`, tone: days <= 1 ? "soon" : "default" };
}

export interface RoadmapForecastsInput {
  readonly items: ReadonlyArray<RoadmapWorkItem>;
  readonly sprints: ReadonlyArray<RoadmapSprint>;
  readonly areaSettings: RoadmapAreasSettings;
  readonly today: IsoDate;
  /** Defaults to the user's local calendar, which is what due dates mean to them. */
  readonly dateOf?: RoadmapDateOf;
}

/**
 * Velocity per area, computed once per area and per source: an item in a
 * sprint measures against the area's recent sprints, any other item against
 * the trailing window.
 */
export function roadmapVelocityLookup(
  input: RoadmapForecastsInput,
): (area: RoadmapArea, inSprint: boolean) => RoadmapVelocity | null {
  const cache = new Map<string, RoadmapVelocity | null>();
  return (area, inSprint) => {
    const key = `${area}:${inSprint}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        velocity({
          items: input.items,
          area,
          settings: input.areaSettings[area],
          today: input.today,
          sprints: input.sprints,
          useSprints: inSprint,
          dateOf: input.dateOf ?? localDateOf,
        }),
      );
    }
    return cache.get(key) ?? null;
  };
}

/** Forecasts for every item that has one; done, unsized and history-less items are left out. */
export function roadmapForecasts(
  input: RoadmapForecastsInput,
): ReadonlyMap<RoadmapItemId, RoadmapForecast> {
  const byId: RoadmapItemsById = new Map(input.items.map((entry) => [entry.id, entry]));
  const velocityOf = roadmapVelocityLookup(input);
  const forecasts = new Map<RoadmapItemId, RoadmapForecast>();
  for (const item of input.items) {
    if (item.state === "done") continue;
    const area = effectiveArea(item.id, byId).area;
    const settings = input.areaSettings[area];
    const result = forecast({
      item,
      byId,
      unit: settings.unit,
      velocity: velocityOf(area, item.sprintId !== null),
      today: input.today,
      weekdays: settings.workingWeekdays,
    });
    if (result.status !== "no-forecast") forecasts.set(item.id, result);
  }
  return forecasts;
}

export type RoadmapForecastShownStatus = Exclude<RoadmapForecastStatus, "no-forecast">;

export const ROADMAP_FORECAST_LABELS: Readonly<Record<RoadmapForecastShownStatus, string>> = {
  "on-track": "On track",
  "at-risk": "At risk",
  late: "Late",
};

export interface RoadmapForecastLabel {
  readonly text: string;
  readonly status: RoadmapForecastShownStatus;
}

/** "On track", or the status with the projected date once off track; null with no forecast. */
export function forecastLabel(value: RoadmapForecast, today: IsoDate): RoadmapForecastLabel | null {
  if (value.status === "no-forecast") return null;
  const label = ROADMAP_FORECAST_LABELS[value.status];
  return {
    text:
      value.status === "on-track" || value.projected === null
        ? label
        : `${label}, ${formatRoadmapDate(value.projected, today)}`,
    status: value.status,
  };
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
  readonly sprintId: RoadmapSprintId | null;
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
    sprintId: null,
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
    sprintId: item.sprintId,
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
      ...(draft.sprintId === null ? {} : { sprintId: draft.sprintId }),
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
  if (draft.sprintId !== item.sprintId) patch.sprintId = draft.sprintId;

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
