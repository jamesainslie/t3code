/**
 * Fork-only roadmap: a tree of work items that threads attach to. The roadmap
 * is its own event stream beside the orchestration log, owned by one
 * environment (the roadmap home).
 */
import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** A calendar date with no time or zone, `YYYY-MM-DD`. */
export const IsoDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export type IsoDate = typeof IsoDate.Type;

const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const RoadmapItemId = TrimmedNonEmptyString.pipe(Schema.brand("RoadmapItemId"));
export type RoadmapItemId = typeof RoadmapItemId.Type;

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
});
export type RoadmapItemPatch = typeof RoadmapItemPatch.Type;

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

export const RoadmapCommand = Schema.Union([
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
]);
export type RoadmapCommand = typeof RoadmapCommand.Type;

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

export const RoadmapEvent = Schema.Union([
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
]);
export type RoadmapEvent = typeof RoadmapEvent.Type;
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
  "deleted",
  "invalid_parent",
  "parent_cycle",
  "blocker_cycle",
  "self_link",
  "already_attached",
  "not_attached",
  "criterion_not_found",
  "roadmap_home_elsewhere",
]);
export type RoadmapRejectionCode = typeof RoadmapRejectionCode.Type;

export const RoadmapErrorCode = Schema.Literals([
  ...RoadmapRejectionCode.literals,
  /** Storage or other server failure; the command may be retried. */
  "internal",
]);
export type RoadmapErrorCode = typeof RoadmapErrorCode.Type;

export class RoadmapError extends Schema.TaggedError<RoadmapError>()("RoadmapError", {
  code: RoadmapErrorCode,
  message: Schema.String,
}) {}
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
]);
export type RoadmapStreamItem = typeof RoadmapStreamItem.Type;

export const RoadmapDispatchInput = Schema.Struct({ command: RoadmapCommand });
export type RoadmapDispatchInput = typeof RoadmapDispatchInput.Type;

export const RoadmapDispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
  itemId: RoadmapItemId,
});
export type RoadmapDispatchResult = typeof RoadmapDispatchResult.Type;
