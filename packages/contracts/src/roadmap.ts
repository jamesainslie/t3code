/**
 * Fork-only roadmap: a tree of work items that threads attach to. The roadmap
 * is its own event stream beside the orchestration log, owned by one
 * environment (the roadmap home).
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** A calendar date with no time or zone, `YYYY-MM-DD`. */
export const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type IsoDate = typeof IsoDate.Type;

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveNumber = Schema.Finite.check(Schema.isGreaterThan(0));

export const RoadmapItemId = TrimmedNonEmptyString.pipe(Schema.brand("RoadmapItemId"));
export type RoadmapItemId = typeof RoadmapItemId.Type;

export const RoadmapSprintId = TrimmedNonEmptyString.pipe(Schema.brand("RoadmapSprintId"));
export type RoadmapSprintId = typeof RoadmapSprintId.Type;

export const RoadmapItemType = Schema.Literals([
  "objective",
  "key-result",
  "initiative",
  "epic",
  "feature",
  "story",
  "bug",
  "support-ticket",
]);
export type RoadmapItemType = typeof RoadmapItemType.Type;

export const RoadmapItemState = Schema.Literals(["backlog", "in-progress", "in-review", "done"]);
export type RoadmapItemState = typeof RoadmapItemState.Type;

export const RoadmapPriority = Schema.Literals(["p0", "p1", "p2", "p3"]);
export type RoadmapPriority = typeof RoadmapPriority.Type;

export const RoadmapArea = Schema.Literals(["work", "personal"]);
export type RoadmapArea = typeof RoadmapArea.Type;

export const RoadmapThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type RoadmapThreadRef = typeof RoadmapThreadRef.Type;

export const RoadmapActor = Schema.Union([
  Schema.TaggedStruct("user", {}),
  Schema.TaggedStruct("agent", { thread: RoadmapThreadRef, threadTitle: Schema.String }),
  Schema.TaggedStruct("steward", { environmentId: EnvironmentId }),
  Schema.TaggedStruct("github", {}),
]);
export type RoadmapActor = typeof RoadmapActor.Type;

export const RoadmapCriterion = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
  tickedAt: Schema.NullOr(IsoDateTime),
  tickedBy: Schema.NullOr(RoadmapActor),
  evidence: Schema.NullOr(Schema.String),
});
export type RoadmapCriterion = typeof RoadmapCriterion.Type;

export const RoadmapExternalBlocker = Schema.Struct({
  id: TrimmedNonEmptyString,
  text: TrimmedNonEmptyString,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type RoadmapExternalBlocker = typeof RoadmapExternalBlocker.Type;

export const RoadmapAttachment = Schema.Struct({
  thread: RoadmapThreadRef,
  attachedAt: IsoDateTime,
});
export type RoadmapAttachment = typeof RoadmapAttachment.Type;

/** Hours logged against an item by hand or by an agent; never derived from turn time. */
export const RoadmapHoursEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  at: IsoDateTime,
  hours: PositiveNumber,
  actor: RoadmapActor,
  note: Schema.NullOr(Schema.String),
});
export type RoadmapHoursEntry = typeof RoadmapHoursEntry.Type;

/**
 * Who may write which kind is the planner's rule: `progress` comes from
 * anyone, `sync` only from GitHub, `drift` and `unsure` only from the steward.
 */
export const RoadmapNoteKind = Schema.Literals(["progress", "drift", "unsure", "sync"]);
export type RoadmapNoteKind = typeof RoadmapNoteKind.Type;

export const RoadmapProgressNote = Schema.Struct({
  id: TrimmedNonEmptyString,
  at: IsoDateTime,
  actor: RoadmapActor,
  kind: RoadmapNoteKind,
  text: TrimmedNonEmptyString,
  criterionId: Schema.NullOr(TrimmedNonEmptyString),
});
export type RoadmapProgressNote = typeof RoadmapProgressNote.Type;

/** An item keeps its newest notes; older ones drop off as new ones arrive. */
export const ROADMAP_NOTE_LIMIT = 50;

/**
 * A GitHub pull request linked to an item, by key only. The card reads its
 * status through the pull request service, so no snapshot rides in events.
 */
export const RoadmapPullRequestLink = Schema.Struct({
  host: TrimmedNonEmptyString,
  /** `owner/name`, lower case, as `parseChangeRequestUrl` gives it. */
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  url: TrimmedNonEmptyString,
});
export type RoadmapPullRequestLink = typeof RoadmapPullRequestLink.Type;

/**
 * What the item and its issue agreed on at the last sync. Each side's change
 * is measured from here, so a field that moved on one side only is copied to
 * the other, and one that moved on both is a conflict. Parent and blockers
 * count only issues that are themselves items.
 */
export const RoadmapIssueSyncBase = Schema.Struct({
  title: Schema.String,
  closed: Schema.Boolean,
  parentNodeId: Schema.NullOr(TrimmedNonEmptyString),
  blockedByNodeIds: Schema.Array(TrimmedNonEmptyString),
});
export type RoadmapIssueSyncBase = typeof RoadmapIssueSyncBase.Type;

/** When a user or agent last changed each synced field here; GitHub's own changes leave it. */
export const RoadmapIssueLocalChanges = Schema.Struct({
  title: Schema.NullOr(IsoDateTime),
  closed: Schema.NullOr(IsoDateTime),
  parent: Schema.NullOr(IsoDateTime),
  blockedBy: Schema.NullOr(IsoDateTime),
});
export type RoadmapIssueLocalChanges = typeof RoadmapIssueLocalChanges.Type;

export const ROADMAP_NO_LOCAL_CHANGES: RoadmapIssueLocalChanges = {
  title: null,
  closed: null,
  parent: null,
  blockedBy: null,
};

/** The GitHub issue an item was imported from, and where the two stood at the last sync. */
export const RoadmapIssueSource = Schema.Struct({
  host: TrimmedNonEmptyString,
  owner: TrimmedNonEmptyString,
  repo: TrimmedNonEmptyString,
  number: PositiveInt,
  nodeId: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  /** Without it the synced fields are read-only here; the planner refuses edits to them. */
  writable: Schema.Boolean,
  /** GitHub's `updatedAt` at the last sync, as GitHub wrote it. */
  remoteUpdatedAt: IsoDateTime,
  syncedAt: IsoDateTime,
  base: RoadmapIssueSyncBase,
  localChangedAt: RoadmapIssueLocalChanges,
});
export type RoadmapIssueSource = typeof RoadmapIssueSource.Type;

export const RoadmapSprint = Schema.Struct({
  id: RoadmapSprintId,
  name: TrimmedNonEmptyString,
  area: RoadmapArea,
  startDate: IsoDate,
  endDate: IsoDate,
});
export type RoadmapSprint = typeof RoadmapSprint.Type;

/** What an area's estimates, burn and velocity count. */
export const RoadmapUnit = Schema.Literals(["items", "criteria", "points", "hours"]);
export type RoadmapUnit = typeof RoadmapUnit.Type;

/** 0 is Sunday, as `Date.prototype.getUTCDay` counts. */
export const RoadmapWeekday = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }));
export type RoadmapWeekday = typeof RoadmapWeekday.Type;

const DEFAULT_WORKING_WEEKDAYS: ReadonlyArray<RoadmapWeekday> = [1, 2, 3, 4, 5];

/** Per-area calendar and unit. Every field defaults so older settings files still decode. */
export const RoadmapAreaSettings = Schema.Struct({
  unit: RoadmapUnit.pipe(Schema.withDecodingDefault(Effect.succeed("points" as const))),
  // An empty week would leave working-day arithmetic with no day to land on.
  workingWeekdays: Schema.Array(RoadmapWeekday)
    .check(Schema.isMinLength(1))
    .pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_WORKING_WEEKDAYS))),
  goingColdDays: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(5))),
});
export type RoadmapAreaSettings = typeof RoadmapAreaSettings.Type;

export const DEFAULT_ROADMAP_AREA_SETTINGS: RoadmapAreaSettings = Schema.decodeSync(
  RoadmapAreaSettings,
)({});

export const RoadmapAreasSettings = Schema.Struct({
  work: RoadmapAreaSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ROADMAP_AREA_SETTINGS)),
  ),
  personal: RoadmapAreaSettings.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ROADMAP_AREA_SETTINGS)),
  ),
});
export type RoadmapAreasSettings = typeof RoadmapAreasSettings.Type;

export const RoadmapAreaSettingsPatch = Schema.Struct({
  unit: Schema.optionalKey(RoadmapUnit),
  workingWeekdays: Schema.optionalKey(Schema.Array(RoadmapWeekday).check(Schema.isMinLength(1))),
  goingColdDays: Schema.optionalKey(PositiveInt),
});
export type RoadmapAreaSettingsPatch = typeof RoadmapAreaSettingsPatch.Type;

export const RoadmapWorkItem = Schema.Struct({
  id: RoadmapItemId,
  type: RoadmapItemType,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  parentId: Schema.NullOr(RoadmapItemId),
  sortKey: Schema.String,
  state: RoadmapItemState,
  /** Null inherits from the parent; a root with none counts as p2. */
  priority: Schema.NullOr(RoadmapPriority),
  /** Null inherits from the parent; a root with none counts as personal. */
  area: Schema.NullOr(RoadmapArea),
  dueDate: Schema.NullOr(IsoDate),
  startDate: Schema.NullOr(IsoDate),
  estimate: Schema.NullOr(NonNegativeNumber),
  criteria: Schema.Array(RoadmapCriterion),
  blockedBy: Schema.Array(RoadmapItemId),
  externalBlockers: Schema.Array(RoadmapExternalBlocker),
  related: Schema.Array(RoadmapItemId),
  attachments: Schema.Array(RoadmapAttachment),
  origin: Schema.NullOr(RoadmapThreadRef),
  needsReview: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  createdBy: RoadmapActor,
  /** Moves only when `state` changes; activity and velocity read it. */
  stateChangedAt: IsoDateTime,
  /** Set on entering done, cleared on reopening. */
  completedAt: Schema.NullOr(IsoDateTime),
  /** Set while the item is one of Today's picks. */
  pinnedAt: Schema.NullOr(IsoDateTime),
  /** Hidden from Today while this date is after today. */
  snoozedUntil: Schema.NullOr(IsoDate),
  sprintId: Schema.NullOr(RoadmapSprintId),
  hours: Schema.Array(RoadmapHoursEntry),
  /**
   * Oldest first, at most `ROADMAP_NOTE_LIMIT`. The default lets items and
   * created events stored before notes decode, so a rebuild needs no upgrade.
   */
  progressNotes: Schema.Array(RoadmapProgressNote).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /** The defaults let items and created events stored before GitHub sync decode. */
  source: Schema.NullOr(RoadmapIssueSource).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  pullRequests: Schema.Array(RoadmapPullRequestLink).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type RoadmapWorkItem = typeof RoadmapWorkItem.Type;

// Commands

const command = <const Type extends string, const Fields extends Schema.Struct.Fields>(
  type: Type,
  fields: Fields,
) => Schema.Struct({ type: Schema.Literal(type), commandId: CommandId, ...fields });

export const RoadmapCriterionInput = Schema.Struct({
  id: Schema.optionalKey(TrimmedNonEmptyString),
  text: TrimmedNonEmptyString,
});
export type RoadmapCriterionInput = typeof RoadmapCriterionInput.Type;

export const RoadmapItemPatch = Schema.Struct({
  type: Schema.optionalKey(RoadmapItemType),
  title: Schema.optionalKey(TrimmedNonEmptyString),
  description: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(RoadmapItemState),
  priority: Schema.optionalKey(Schema.NullOr(RoadmapPriority)),
  area: Schema.optionalKey(Schema.NullOr(RoadmapArea)),
  dueDate: Schema.optionalKey(Schema.NullOr(IsoDate)),
  startDate: Schema.optionalKey(Schema.NullOr(IsoDate)),
  estimate: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  sprintId: Schema.optionalKey(Schema.NullOr(RoadmapSprintId)),
});
export type RoadmapItemPatch = typeof RoadmapItemPatch.Type;

export const RoadmapSprintPatch = Schema.Struct({
  name: Schema.optionalKey(TrimmedNonEmptyString),
  area: Schema.optionalKey(RoadmapArea),
  startDate: Schema.optionalKey(IsoDate),
  endDate: Schema.optionalKey(IsoDate),
});
export type RoadmapSprintPatch = typeof RoadmapSprintPatch.Type;

export const RoadmapItemCreateCommand = command("roadmap.item.create", {
  itemId: RoadmapItemId,
  // `type` is the command discriminator, so the item's type travels as `itemType`.
  itemType: RoadmapItemType,
  title: TrimmedNonEmptyString,
  description: Schema.optionalKey(Schema.String),
  parentId: Schema.optionalKey(Schema.NullOr(RoadmapItemId)),
  area: Schema.optionalKey(Schema.NullOr(RoadmapArea)),
  priority: Schema.optionalKey(Schema.NullOr(RoadmapPriority)),
  state: Schema.optionalKey(RoadmapItemState),
  dueDate: Schema.optionalKey(Schema.NullOr(IsoDate)),
  estimate: Schema.optionalKey(Schema.NullOr(NonNegativeNumber)),
  sprintId: Schema.optionalKey(Schema.NullOr(RoadmapSprintId)),
  criteria: Schema.optionalKey(Schema.Array(RoadmapCriterionInput)),
  origin: Schema.optionalKey(Schema.NullOr(RoadmapThreadRef)),
  attachThread: Schema.optionalKey(RoadmapThreadRef),
});
export const RoadmapItemUpdateCommand = command("roadmap.item.update", {
  itemId: RoadmapItemId,
  patch: RoadmapItemPatch,
});
/** `beforeId` places the item before that sibling, `afterId` after it; neither appends. */
export const RoadmapItemMoveCommand = command("roadmap.item.move", {
  itemId: RoadmapItemId,
  parentId: Schema.NullOr(RoadmapItemId),
  beforeId: Schema.optionalKey(RoadmapItemId),
  afterId: Schema.optionalKey(RoadmapItemId),
});
export const RoadmapItemDeleteCommand = command("roadmap.item.delete", { itemId: RoadmapItemId });
export const RoadmapItemRestoreCommand = command("roadmap.item.restore", { itemId: RoadmapItemId });
export const RoadmapCriteriaSetCommand = command("roadmap.criteria.set", {
  itemId: RoadmapItemId,
  criteria: Schema.Array(RoadmapCriterionInput),
});
export const RoadmapCriterionTickCommand = command("roadmap.criterion.tick", {
  itemId: RoadmapItemId,
  criterionId: TrimmedNonEmptyString,
  ticked: Schema.Boolean,
  evidence: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const RoadmapBlockerLinkCommand = command("roadmap.blocker.link", {
  itemId: RoadmapItemId,
  blockedById: RoadmapItemId,
});
export const RoadmapBlockerUnlinkCommand = command("roadmap.blocker.unlink", {
  itemId: RoadmapItemId,
  blockedById: RoadmapItemId,
});
export const RoadmapExternalBlockerAddCommand = command("roadmap.external-blocker.add", {
  itemId: RoadmapItemId,
  text: TrimmedNonEmptyString,
});
export const RoadmapExternalBlockerResolveCommand = command("roadmap.external-blocker.resolve", {
  itemId: RoadmapItemId,
  blockerId: TrimmedNonEmptyString,
  resolved: Schema.Boolean,
});
export const RoadmapExternalBlockerRemoveCommand = command("roadmap.external-blocker.remove", {
  itemId: RoadmapItemId,
  blockerId: TrimmedNonEmptyString,
});
export const RoadmapRelatedLinkCommand = command("roadmap.related.link", {
  itemId: RoadmapItemId,
  relatedId: RoadmapItemId,
});
export const RoadmapRelatedUnlinkCommand = command("roadmap.related.unlink", {
  itemId: RoadmapItemId,
  relatedId: RoadmapItemId,
});
export const RoadmapThreadAttachCommand = command("roadmap.thread.attach", {
  itemId: RoadmapItemId,
  thread: RoadmapThreadRef,
});
export const RoadmapThreadDetachCommand = command("roadmap.thread.detach", {
  itemId: RoadmapItemId,
  thread: RoadmapThreadRef,
});
export const RoadmapItemMarkReviewedCommand = command("roadmap.item.mark-reviewed", {
  itemId: RoadmapItemId,
});
export const RoadmapItemPinCommand = command("roadmap.item.pin", { itemId: RoadmapItemId });
export const RoadmapItemUnpinCommand = command("roadmap.item.unpin", { itemId: RoadmapItemId });
export const RoadmapItemSnoozeCommand = command("roadmap.item.snooze", {
  itemId: RoadmapItemId,
  until: IsoDate,
});
export const RoadmapItemUnsnoozeCommand = command("roadmap.item.unsnooze", {
  itemId: RoadmapItemId,
});
/** `entryId` is the caller's, so a retried log never adds the hours twice. */
export const RoadmapHoursLogCommand = command("roadmap.hours.log", {
  itemId: RoadmapItemId,
  entryId: TrimmedNonEmptyString,
  hours: PositiveNumber,
  note: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const RoadmapHoursRemoveCommand = command("roadmap.hours.remove", {
  itemId: RoadmapItemId,
  entryId: TrimmedNonEmptyString,
});
/** `noteId` is the caller's, so a retried add never writes the note twice. */
export const RoadmapNoteAddCommand = command("roadmap.note.add", {
  itemId: RoadmapItemId,
  noteId: TrimmedNonEmptyString,
  kind: RoadmapNoteKind,
  text: TrimmedNonEmptyString,
  criterionId: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export const RoadmapNoteRemoveCommand = command("roadmap.note.remove", {
  itemId: RoadmapItemId,
  noteId: TrimmedNonEmptyString,
});
/** GitHub sync's own: creates an item from an issue. Users import through the sync service. */
export const RoadmapSourceImportCommand = command("roadmap.source.import", {
  itemId: RoadmapItemId,
  itemType: RoadmapItemType,
  title: TrimmedNonEmptyString,
  parentId: Schema.NullOr(RoadmapItemId),
  area: Schema.NullOr(RoadmapArea),
  state: RoadmapItemState,
  source: RoadmapIssueSource,
});
/** GitHub sync's own: records where the item and its issue now agree. */
export const RoadmapSourceSyncCommand = command("roadmap.source.sync", {
  itemId: RoadmapItemId,
  writable: Schema.Boolean,
  remoteUpdatedAt: IsoDateTime,
  base: RoadmapIssueSyncBase,
});
/** Stops syncing the item; it stays as a Lathe-only item and the issue is untouched. */
export const RoadmapSourceUnlinkCommand = command("roadmap.source.unlink", {
  itemId: RoadmapItemId,
});
export const RoadmapPullRequestLinkCommand = command("roadmap.pull-request.link", {
  itemId: RoadmapItemId,
  pullRequest: RoadmapPullRequestLink,
});
export const RoadmapPullRequestUnlinkCommand = command("roadmap.pull-request.unlink", {
  itemId: RoadmapItemId,
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export const RoadmapSprintCreateCommand = command("roadmap.sprint.create", {
  sprintId: RoadmapSprintId,
  name: TrimmedNonEmptyString,
  area: RoadmapArea,
  startDate: IsoDate,
  endDate: IsoDate,
});
export const RoadmapSprintUpdateCommand = command("roadmap.sprint.update", {
  sprintId: RoadmapSprintId,
  patch: RoadmapSprintPatch,
});
/** Also clears the sprint from every item in it, in the same commit. */
export const RoadmapSprintDeleteCommand = command("roadmap.sprint.delete", {
  sprintId: RoadmapSprintId,
});

/** Commands about one work item; each names it as `itemId`. */
export const RoadmapItemCommand = Schema.Union([
  RoadmapItemCreateCommand,
  RoadmapItemUpdateCommand,
  RoadmapItemMoveCommand,
  RoadmapItemDeleteCommand,
  RoadmapItemRestoreCommand,
  RoadmapCriteriaSetCommand,
  RoadmapCriterionTickCommand,
  RoadmapBlockerLinkCommand,
  RoadmapBlockerUnlinkCommand,
  RoadmapExternalBlockerAddCommand,
  RoadmapExternalBlockerResolveCommand,
  RoadmapExternalBlockerRemoveCommand,
  RoadmapRelatedLinkCommand,
  RoadmapRelatedUnlinkCommand,
  RoadmapThreadAttachCommand,
  RoadmapThreadDetachCommand,
  RoadmapItemMarkReviewedCommand,
  RoadmapItemPinCommand,
  RoadmapItemUnpinCommand,
  RoadmapItemSnoozeCommand,
  RoadmapItemUnsnoozeCommand,
  RoadmapHoursLogCommand,
  RoadmapHoursRemoveCommand,
  RoadmapNoteAddCommand,
  RoadmapNoteRemoveCommand,
  RoadmapSourceImportCommand,
  RoadmapSourceSyncCommand,
  RoadmapSourceUnlinkCommand,
  RoadmapPullRequestLinkCommand,
  RoadmapPullRequestUnlinkCommand,
]);
export type RoadmapItemCommand = typeof RoadmapItemCommand.Type;

/** Commands about one sprint; each names it as `sprintId`. */
export const RoadmapSprintCommand = Schema.Union([
  RoadmapSprintCreateCommand,
  RoadmapSprintUpdateCommand,
  RoadmapSprintDeleteCommand,
]);
export type RoadmapSprintCommand = typeof RoadmapSprintCommand.Type;

export const RoadmapCommand = Schema.Union([
  ...RoadmapItemCommand.members,
  ...RoadmapSprintCommand.members,
]);
export type RoadmapCommand = typeof RoadmapCommand.Type;

export const isRoadmapSprintCommand = (command: RoadmapCommand): command is RoadmapSprintCommand =>
  command.type.startsWith("roadmap.sprint.");

// Events

const event = <const Type extends string, const Payload extends Schema.Top>(
  type: Type,
  payload: Payload,
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    eventId: EventId,
    itemId: RoadmapItemId,
    actor: RoadmapActor,
    occurredAt: IsoDateTime,
    payload,
  });

const sprintEvent = <const Type extends string, const Payload extends Schema.Top>(
  type: Type,
  payload: Payload,
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    eventId: EventId,
    sprintId: RoadmapSprintId,
    actor: RoadmapActor,
    occurredAt: IsoDateTime,
    payload,
  });

export const RoadmapItemEvent = Schema.Union([
  event("roadmap.item.created", Schema.Struct({ item: RoadmapWorkItem })),
  event("roadmap.item.updated", RoadmapItemPatch),
  event(
    "roadmap.item.moved",
    Schema.Struct({ parentId: Schema.NullOr(RoadmapItemId), sortKey: Schema.String }),
  ),
  /** Every id this delete removed, so restore brings back exactly those. */
  event("roadmap.item.deleted", Schema.Struct({ deletedIds: Schema.Array(RoadmapItemId) })),
  event("roadmap.item.restored", Schema.Struct({ restoredIds: Schema.Array(RoadmapItemId) })),
  event("roadmap.criteria.set", Schema.Struct({ criteria: Schema.Array(RoadmapCriterion) })),
  event(
    "roadmap.criterion.ticked",
    Schema.Struct({
      criterionId: TrimmedNonEmptyString,
      ticked: Schema.Boolean,
      evidence: Schema.NullOr(Schema.String),
    }),
  ),
  event("roadmap.blocker.linked", Schema.Struct({ blockedById: RoadmapItemId })),
  event("roadmap.blocker.unlinked", Schema.Struct({ blockedById: RoadmapItemId })),
  event("roadmap.external-blocker.added", Schema.Struct({ blocker: RoadmapExternalBlocker })),
  event(
    "roadmap.external-blocker.resolved",
    Schema.Struct({ blockerId: TrimmedNonEmptyString, resolved: Schema.Boolean }),
  ),
  event("roadmap.external-blocker.removed", Schema.Struct({ blockerId: TrimmedNonEmptyString })),
  event("roadmap.related.linked", Schema.Struct({ relatedId: RoadmapItemId })),
  event("roadmap.related.unlinked", Schema.Struct({ relatedId: RoadmapItemId })),
  event("roadmap.thread.attached", Schema.Struct({ thread: RoadmapThreadRef })),
  event("roadmap.thread.detached", Schema.Struct({ thread: RoadmapThreadRef })),
  event("roadmap.item.reviewed", Schema.Struct({})),
  event("roadmap.item.pinned", Schema.Struct({})),
  event("roadmap.item.unpinned", Schema.Struct({})),
  event("roadmap.item.snoozed", Schema.Struct({ until: IsoDate })),
  event("roadmap.item.unsnoozed", Schema.Struct({})),
  event("roadmap.hours.logged", Schema.Struct({ entry: RoadmapHoursEntry })),
  event("roadmap.hours.removed", Schema.Struct({ entryId: TrimmedNonEmptyString })),
  event("roadmap.note.added", Schema.Struct({ note: RoadmapProgressNote })),
  event("roadmap.note.removed", Schema.Struct({ noteId: TrimmedNonEmptyString })),
  event(
    "roadmap.source.synced",
    Schema.Struct({
      writable: Schema.Boolean,
      remoteUpdatedAt: IsoDateTime,
      syncedAt: IsoDateTime,
      base: RoadmapIssueSyncBase,
    }),
  ),
  event("roadmap.source.unlinked", Schema.Struct({})),
  event("roadmap.pull-request.linked", Schema.Struct({ pullRequest: RoadmapPullRequestLink })),
  event(
    "roadmap.pull-request.unlinked",
    Schema.Struct({
      host: TrimmedNonEmptyString,
      repository: TrimmedNonEmptyString,
      number: PositiveInt,
    }),
  ),
]);
export type RoadmapItemEvent = typeof RoadmapItemEvent.Type;

export const RoadmapSprintEvent = Schema.Union([
  sprintEvent("roadmap.sprint.created", Schema.Struct({ sprint: RoadmapSprint })),
  sprintEvent("roadmap.sprint.updated", RoadmapSprintPatch),
  /** Every item the delete took out of the sprint. */
  sprintEvent(
    "roadmap.sprint.deleted",
    Schema.Struct({ clearedItemIds: Schema.Array(RoadmapItemId) }),
  ),
]);
export type RoadmapSprintEvent = typeof RoadmapSprintEvent.Type;

export const RoadmapEvent = Schema.Union([
  ...RoadmapItemEvent.members,
  ...RoadmapSprintEvent.members,
]);
export type RoadmapEvent = typeof RoadmapEvent.Type;

export const isRoadmapSprintEvent = (event: RoadmapEvent): event is RoadmapSprintEvent =>
  event.type.startsWith("roadmap.sprint.");
export type RoadmapEventType = RoadmapEvent["type"];

export const RoadmapStoredEvent = Schema.Struct({
  sequence: NonNegativeInt,
  commandId: CommandId,
  event: RoadmapEvent,
});
export type RoadmapStoredEvent = typeof RoadmapStoredEvent.Type;

// Errors

export const RoadmapRejectionCode = Schema.Literals([
  "not_found",
  "already_exists",
  "deleted",
  "invalid_parent",
  "parent_cycle",
  "blocker_cycle",
  "self_link",
  "already_attached",
  "not_attached",
  "criterion_not_found",
  "roadmap_home_elsewhere",
  /** Today holds at most three picks. */
  "pin_limit",
  /**
   * Pins, snoozes, sprints and removing notes are the user's; a note kind
   * other than `progress` belongs to one actor.
   */
  "forbidden_actor",
  /** Well-formed but meaningless, such as a snooze into the past or a sprint ending first. */
  "invalid_request",
  /** The item's issue cannot be written with this environment's GitHub account. */
  "read_only_source",
]);
export type RoadmapRejectionCode = typeof RoadmapRejectionCode.Type;

/** Today's picks; the planner refuses a fourth pin rather than bumping one. */
export const ROADMAP_PIN_LIMIT = 3;

export const RoadmapErrorCode = Schema.Literals([
  ...RoadmapRejectionCode.literals,
  /** Storage or other server failure; the command may be retried. */
  "internal",
]);
export type RoadmapErrorCode = typeof RoadmapErrorCode.Type;

// The status matters only to the roadmap HTTP API, where a linked environment
// tells a refusal apart from a transport failure.
export class RoadmapError extends Schema.TaggedError<RoadmapError>()(
  "RoadmapError",
  {
    code: RoadmapErrorCode,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}
export const isRoadmapError = Schema.is(RoadmapError);

// RPC payloads

export const RoadmapSubscribeInput = Schema.Struct({});
export type RoadmapSubscribeInput = typeof RoadmapSubscribeInput.Type;

/** A snapshot first, then deltas; clients drop deltas at or below the snapshot sequence. */
export const RoadmapStreamItem = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    sequence: NonNegativeInt,
    items: Schema.Array(RoadmapWorkItem),
    sprints: Schema.Array(RoadmapSprint),
  }),
  Schema.Struct({
    type: Schema.Literal("item.upserted"),
    sequence: NonNegativeInt,
    item: RoadmapWorkItem,
  }),
  Schema.Struct({
    type: Schema.Literal("item.removed"),
    sequence: NonNegativeInt,
    itemId: RoadmapItemId,
  }),
  Schema.Struct({
    type: Schema.Literal("sprint.upserted"),
    sequence: NonNegativeInt,
    sprint: RoadmapSprint,
  }),
  Schema.Struct({
    type: Schema.Literal("sprint.removed"),
    sequence: NonNegativeInt,
    sprintId: RoadmapSprintId,
  }),
]);
export type RoadmapStreamItem = typeof RoadmapStreamItem.Type;

export const RoadmapDispatchInput = Schema.Struct({ command: RoadmapCommand });
export type RoadmapDispatchInput = typeof RoadmapDispatchInput.Type;

/**
 * Imports a GitHub issue and its sub-issue tree on the home. Without a parent
 * the issue becomes a top-level item in `area`, unless the account its
 * repository routes to names an area in `roadmap.areaByLogin`.
 */
export const RoadmapImportIssueInput = Schema.Struct({
  url: TrimmedNonEmptyString,
  area: Schema.optionalKey(Schema.NullOr(RoadmapArea)),
  parentId: Schema.optionalKey(Schema.NullOr(RoadmapItemId)),
});
export type RoadmapImportIssueInput = typeof RoadmapImportIssueInput.Type;

export const RoadmapImportIssueResult = Schema.Struct({
  /** The issue's item, new or already there. */
  itemId: RoadmapItemId,
  /** Items this import created, the issue's own included; 0 when it was already imported. */
  imported: NonNegativeInt,
});
export type RoadmapImportIssueResult = typeof RoadmapImportIssueResult.Type;

export const RoadmapDispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
  /** Null for sprint commands, which name no item. */
  itemId: Schema.NullOr(RoadmapItemId),
});
export type RoadmapDispatchResult = typeof RoadmapDispatchResult.Type;

// The one-way link: another environment reads and changes the home's roadmap
// over the home's roadmap HTTP API, with a roadmap-link credential.

/** Everything the roadmap tools compute over: items, sprints and each area's settings. */
export const RoadmapLinkSnapshot = Schema.Struct({
  items: Schema.Array(RoadmapWorkItem),
  sprints: Schema.Array(RoadmapSprint),
  areas: RoadmapAreasSettings,
});
export type RoadmapLinkSnapshot = typeof RoadmapLinkSnapshot.Type;

/** A live item, or null for a missing or deleted one, with its latest events. */
export const RoadmapLinkItem = Schema.Struct({
  item: Schema.NullOr(RoadmapWorkItem),
  history: Schema.Array(RoadmapStoredEvent),
});
export type RoadmapLinkItem = typeof RoadmapLinkItem.Type;

/** The items a thread is attached to, and the block its agent sees each turn ("" for none). */
export const RoadmapThreadContext = Schema.Struct({
  items: Schema.Array(RoadmapWorkItem),
  context: Schema.String,
});
export type RoadmapThreadContext = typeof RoadmapThreadContext.Type;

export const RoadmapLinkDispatchInput = Schema.Struct({
  command: RoadmapCommand,
  actor: RoadmapActor,
});
export type RoadmapLinkDispatchInput = typeof RoadmapLinkDispatchInput.Type;

/** A write from a linked environment: applied on the home, or waiting in the link's queue. */
export const RoadmapSubmitResult = Schema.Union([
  Schema.Struct({
    queued: Schema.Literal(false),
    sequence: NonNegativeInt,
    itemId: Schema.NullOr(RoadmapItemId),
  }),
  Schema.Struct({ queued: Schema.Literal(true), itemId: Schema.NullOr(RoadmapItemId) }),
]);
export type RoadmapSubmitResult = typeof RoadmapSubmitResult.Type;

/**
 * `unreachable` is the last call to the home failing; `since` is when the
 * first of that run failed. Writes wait in the queue meanwhile.
 */
export const RoadmapLinkStatus = Schema.Struct({
  state: Schema.Literals(["not-linked", "linked", "unreachable"]),
  homeUrl: Schema.NullOr(Schema.String),
  unreachableSince: Schema.NullOr(IsoDateTime),
  /** Writes waiting to reach the home. */
  queued: NonNegativeInt,
  /** Writes the home refused; they are kept, not retried. */
  rejected: NonNegativeInt,
});
export type RoadmapLinkStatus = typeof RoadmapLinkStatus.Type;

/** A home URL and a one-time link grant minted on the home, or null to unlink. */
export const RoadmapLinkConfigureInput = Schema.Struct({
  link: Schema.NullOr(
    Schema.Struct({ homeUrl: TrimmedNonEmptyString, credential: TrimmedNonEmptyString }),
  ),
});
export type RoadmapLinkConfigureInput = typeof RoadmapLinkConfigureInput.Type;

export const RoadmapLinkMintInput = Schema.Struct({
  /** The environment the link speaks for; the home binds its agents' writes to it. */
  environmentId: EnvironmentId,
  label: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RoadmapLinkMintInput = typeof RoadmapLinkMintInput.Type;

export const RoadmapLinkMintResult = Schema.Struct({
  credential: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
});
export type RoadmapLinkMintResult = typeof RoadmapLinkMintResult.Type;

export class RoadmapLinkError extends Schema.TaggedError<RoadmapLinkError>()("RoadmapLinkError", {
  reason: Schema.Literals(["invalid_url", "unreachable", "credential_rejected", "storage"]),
  message: Schema.String,
}) {}
