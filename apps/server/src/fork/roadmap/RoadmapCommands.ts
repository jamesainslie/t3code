/**
 * The roadmap's pure decider and projector. The service reads state under its
 * lock, plans one event here, and commits it with the projection this module
 * computes; nothing here does I/O.
 */
import {
  type EventId,
  isRoadmapSprintCommand,
  ROADMAP_NOTE_LIMIT,
  ROADMAP_PIN_LIMIT,
  type IsoDateTime,
  type RoadmapActor,
  type RoadmapArea,
  type RoadmapCommand,
  type RoadmapCriterion,
  type RoadmapCriterionInput,
  RoadmapError,
  type RoadmapEvent,
  type RoadmapItemEvent,
  type RoadmapItemId,
  type RoadmapIssueLocalChanges,
  type RoadmapNoteKind,
  type RoadmapPullRequestLink,
  type RoadmapRejectionCode,
  type RoadmapSprint,
  type RoadmapSprintCommand,
  type RoadmapSprintEvent,
  type RoadmapSprintId,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
} from "@lathe/contracts";
import {
  canParent,
  DEFAULT_ROADMAP_AREA,
  sortKeyBetween,
  wouldCreateBlockerCycle,
  wouldCreateParentCycle,
} from "@lathe/shared/roadmap";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export interface RoadmapItemRecord {
  readonly item: RoadmapWorkItem;
  readonly deletedAt: IsoDateTime | null;
}

export interface RoadmapCommandState {
  /** Every item, deleted ones included. */
  readonly items: ReadonlyMap<RoadmapItemId, RoadmapItemRecord>;
  readonly sprints?: ReadonlyMap<RoadmapSprintId, RoadmapSprint>;
  /** For restore: the ids the latest delete covering the target removed. */
  readonly lastDeletion?: ReadonlyArray<RoadmapItemId>;
  /**
   * For a steward tick: when its criterion was last unticked. Unticks clear the
   * criterion, so only the event history holds this time.
   */
  readonly criterionUntickedAt?: IsoDateTime;
}

export interface RoadmapSprintChange {
  readonly sprint: RoadmapSprint;
  readonly removed: boolean;
}

const sameThread = (left: RoadmapThreadRef, right: RoadmapThreadRef) =>
  left.environmentId === right.environmentId && left.threadId === right.threadId;

type PullRequestKey = Pick<RoadmapPullRequestLink, "host" | "repository" | "number">;

const samePullRequest = (left: PullRequestKey, right: PullRequestKey) =>
  left.host === right.host && left.repository === right.repository && left.number === right.number;

const reject = (code: RoadmapRejectionCode, message: string) =>
  Result.fail(new RoadmapError({ code, message }));

const userOnly = (actor: RoadmapActor, what: string) =>
  actor._tag === "user"
    ? undefined
    : new RoadmapError({ code: "forbidden_actor", message: `Only the user can change ${what}.` });

const githubOnly = (actor: RoadmapActor, what: string) =>
  actor._tag === "github"
    ? undefined
    : new RoadmapError({ code: "forbidden_actor", message: `Only GitHub sync can ${what}.` });

/** Design 11: a pull request links to the item types that ship code. */
const PULL_REQUEST_TYPES: ReadonlySet<RoadmapWorkItem["type"]> = new Set([
  "feature",
  "story",
  "bug",
  "support-ticket",
]);

/**
 * GitHub sync applies what the issue says whatever the account may write;
 * everyone else edits the synced fields only where it could push them back.
 */
const isReadOnly = (item: RoadmapWorkItem, actor: RoadmapActor) =>
  actor._tag !== "github" && item.source !== null && !item.source.writable;

const readOnlyRefusal = (item: RoadmapWorkItem) =>
  reject(
    "read_only_source",
    `${label(item)} follows issue #${item.source?.number ?? "?"}, which this environment's GitHub account cannot change. Edit it on GitHub.`,
  );

/**
 * The earliest calendar date it can be anywhere (UTC-12). The server does not
 * know the user's zone, so only a date on or before this one is surely past
 * for them; a date in the one-day ambiguity is accepted and simply expires.
 */
const earliestToday = (now: DateTime.Utc) =>
  DateTime.formatIsoDateUtc(DateTime.subtract(now, { hours: 12 }));

const bySortKey = (left: RoadmapWorkItem, right: RoadmapWorkItem) =>
  left.sortKey < right.sortKey
    ? -1
    : left.sortKey > right.sortKey
      ? 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0;

const label = (item: RoadmapWorkItem) => `${item.type} "${item.title}"`;

function buildCriteria(
  inputs: ReadonlyArray<RoadmapCriterionInput>,
  existing: ReadonlyArray<RoadmapCriterion>,
  eventId: EventId,
): ReadonlyArray<RoadmapCriterion> {
  const kept = new Map(existing.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  const criteria: Array<RoadmapCriterion> = [];
  for (const [index, input] of inputs.entries()) {
    const criterionId = input.id ?? `${eventId}:${index}`;
    if (seen.has(criterionId)) continue;
    seen.add(criterionId);
    const previous = kept.get(criterionId);
    criteria.push(
      previous === undefined
        ? { id: criterionId, text: input.text, tickedAt: null, tickedBy: null, evidence: null }
        : { ...previous, text: input.text },
    );
  }
  return criteria;
}

export function planRoadmapCommand(input: {
  readonly command: RoadmapCommand;
  readonly actor: RoadmapActor;
  readonly state: RoadmapCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<RoadmapEvent, RoadmapError> {
  const { command, actor, state, eventId } = input;
  // The steward reports what it saw. Every judgement about the plan stays with
  // the user and the agents, so it reaches nothing else.
  if (
    actor._tag === "steward" &&
    command.type !== "roadmap.criterion.tick" &&
    command.type !== "roadmap.note.add"
  ) {
    return reject("forbidden_actor", "The steward can only tick criteria and add notes.");
  }
  if (isRoadmapSprintCommand(command)) {
    return planSprintCommand({ ...input, command });
  }
  const occurredAt = DateTime.formatIso(input.now);
  const base = { eventId, itemId: command.itemId, actor, occurredAt };
  const records = state.items;
  const liveItem = (itemId: RoadmapItemId) => {
    const record = records.get(itemId);
    return record !== undefined && record.deletedAt === null ? record.item : undefined;
  };
  const liveItems = () =>
    [...records.values()].flatMap((record) => (record.deletedAt === null ? [record.item] : []));
  const byId = new Map(liveItems().map((item) => [item.id, item]));
  const requireLive = (itemId: RoadmapItemId): Result.Result<RoadmapWorkItem, RoadmapError> => {
    const record = records.get(itemId);
    if (record === undefined) return reject("not_found", `Work item ${itemId} does not exist.`);
    if (record.deletedAt !== null) {
      return reject("deleted", `Work item ${label(record.item)} is deleted.`);
    }
    return Result.succeed(record.item);
  };
  const siblingsOf = (parentId: RoadmapItemId | null, except: RoadmapItemId) =>
    liveItems()
      .filter((item) => item.parentId === parentId && item.id !== except)
      .sort(bySortKey);
  const attachedElsewhere = (thread: RoadmapThreadRef, itemId: RoadmapItemId) =>
    liveItems().find(
      (item) =>
        item.id !== itemId &&
        item.attachments.some((attachment) => sameThread(attachment.thread, thread)),
    );
  const alreadyAttached = (other: RoadmapWorkItem) =>
    reject("already_attached", `The thread is already attached to ${label(other)}.`);
  const requireParent = (
    parentId: RoadmapItemId,
    childType: RoadmapWorkItem["type"],
  ): Result.Result<RoadmapWorkItem, RoadmapError> =>
    Result.flatMap(requireLive(parentId), (parent) =>
      canParent(parent.type, childType)
        ? Result.succeed(parent)
        : reject("invalid_parent", `A ${childType} cannot sit under ${label(parent)}.`),
    );

  switch (command.type) {
    case "roadmap.item.create": {
      if (records.has(command.itemId)) {
        return reject("already_exists", `Work item ${command.itemId} already exists.`);
      }
      const parentId = command.parentId ?? null;
      if (parentId !== null) {
        const parent = requireParent(parentId, command.itemType);
        if (Result.isFailure(parent)) return Result.fail(parent.failure);
      }
      if (command.attachThread !== undefined) {
        const other = attachedElsewhere(command.attachThread, command.itemId);
        if (other !== undefined) return alreadyAttached(other);
      }
      if (command.sprintId !== undefined) {
        const forbidden = userOnly(actor, "sprints");
        if (forbidden !== undefined) return Result.fail(forbidden);
        if (command.sprintId !== null && state.sprints?.has(command.sprintId) !== true) {
          return reject("invalid_request", `Sprint ${command.sprintId} does not exist.`);
        }
      }
      const siblings = siblingsOf(parentId, command.itemId);
      const initialState = command.state ?? "backlog";
      const item: RoadmapWorkItem = {
        id: command.itemId,
        type: command.itemType,
        title: command.title,
        description: command.description ?? "",
        parentId,
        sortKey: sortKeyBetween(siblings.at(-1)?.sortKey ?? null, null),
        state: initialState,
        priority: command.priority ?? null,
        area:
          command.area !== undefined
            ? command.area
            : parentId === null
              ? lastUserRootArea(liveItems())
              : null,
        dueDate: command.dueDate ?? null,
        startDate: null,
        estimate: command.estimate ?? null,
        criteria: buildCriteria(command.criteria ?? [], [], eventId),
        blockedBy: [],
        externalBlockers: [],
        related: [],
        attachments:
          command.attachThread === undefined
            ? []
            : [{ thread: command.attachThread, attachedAt: occurredAt }],
        origin: command.origin ?? null,
        needsReview: actor._tag === "agent",
        createdAt: occurredAt,
        updatedAt: occurredAt,
        createdBy: actor,
        stateChangedAt: occurredAt,
        completedAt: initialState === "done" ? occurredAt : null,
        pinnedAt: null,
        snoozedUntil: null,
        sprintId: command.sprintId ?? null,
        hours: [],
        progressNotes: [],
        source: null,
        pullRequests: [],
      };
      return Result.succeed({ ...base, type: "roadmap.item.created", payload: { item } });
    }

    case "roadmap.source.import": {
      const forbidden = githubOnly(actor, "import issues");
      if (forbidden !== undefined) return Result.fail(forbidden);
      if (records.has(command.itemId)) {
        return reject("already_exists", `Work item ${command.itemId} already exists.`);
      }
      const holder = liveItems().find((other) => other.source?.nodeId === command.source.nodeId);
      if (holder !== undefined) {
        return reject(
          "already_exists",
          `Issue #${command.source.number} is already ${label(holder)}.`,
        );
      }
      if (command.parentId !== null) {
        const parent = requireParent(command.parentId, command.itemType);
        if (Result.isFailure(parent)) return Result.fail(parent.failure);
      }
      const siblings = siblingsOf(command.parentId, command.itemId);
      const item: RoadmapWorkItem = {
        id: command.itemId,
        type: command.itemType,
        title: command.title,
        description: "",
        parentId: command.parentId,
        sortKey: sortKeyBetween(siblings.at(-1)?.sortKey ?? null, null),
        state: command.state,
        priority: null,
        area: command.area,
        dueDate: null,
        startDate: null,
        estimate: null,
        criteria: [],
        blockedBy: [],
        externalBlockers: [],
        related: [],
        attachments: [],
        origin: null,
        needsReview: false,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        createdBy: actor,
        stateChangedAt: occurredAt,
        completedAt: command.state === "done" ? occurredAt : null,
        pinnedAt: null,
        snoozedUntil: null,
        sprintId: null,
        hours: [],
        progressNotes: [],
        source: command.source,
        pullRequests: [],
      };
      return Result.succeed({ ...base, type: "roadmap.item.created", payload: { item } });
    }

    case "roadmap.source.sync": {
      const forbidden = githubOnly(actor, "sync issues");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (current.success.source === null) {
        return reject("invalid_request", `${label(current.success)} has no issue to sync.`);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.source.synced",
        payload: {
          writable: command.writable,
          remoteUpdatedAt: command.remoteUpdatedAt,
          syncedAt: occurredAt,
          base: command.base,
        },
      });
    }

    case "roadmap.source.unlink": {
      if (actor._tag !== "user" && actor._tag !== "github") {
        return reject("forbidden_actor", "Only the user can stop syncing an item with its issue.");
      }
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (current.success.source === null) {
        return reject("invalid_request", `${label(current.success)} has no issue.`);
      }
      return Result.succeed({ ...base, type: "roadmap.source.unlinked", payload: {} });
    }

    case "roadmap.pull-request.link": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (!PULL_REQUEST_TYPES.has(current.success.type)) {
        return reject(
          "invalid_request",
          `Pull requests link to features, stories, bugs and support tickets, not ${label(current.success)}.`,
        );
      }
      const { pullRequest } = command;
      return Result.succeed({
        ...base,
        type: "roadmap.pull-request.linked",
        payload: {
          pullRequest: {
            ...pullRequest,
            host: pullRequest.host.toLowerCase(),
            repository: pullRequest.repository.toLowerCase(),
          },
        },
      });
    }

    case "roadmap.pull-request.unlink": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.pull-request.unlinked",
        payload: {
          host: command.host.toLowerCase(),
          repository: command.repository.toLowerCase(),
          number: command.number,
        },
      });
    }

    case "roadmap.item.update": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const item = current.success;
      if (
        isReadOnly(item, actor) &&
        ((command.patch.title !== undefined && command.patch.title !== item.title) ||
          (command.patch.state !== undefined &&
            (command.patch.state === "done") !== (item.state === "done")))
      ) {
        return readOnlyRefusal(item);
      }
      const nextType = command.patch.type;
      if (nextType !== undefined && nextType !== item.type) {
        const parent = item.parentId === null ? undefined : liveItem(item.parentId);
        if (parent !== undefined && !canParent(parent.type, nextType)) {
          return reject("invalid_parent", `A ${nextType} cannot sit under ${label(parent)}.`);
        }
        const child = siblingsOf(item.id, item.id).find(
          (entry) => !canParent(nextType, entry.type),
        );
        if (child !== undefined) {
          return reject("invalid_parent", `A ${nextType} cannot hold ${label(child)}.`);
        }
      }
      const sprintId = command.patch.sprintId;
      if (sprintId !== undefined) {
        const forbidden = userOnly(actor, "sprints");
        if (forbidden !== undefined) return Result.fail(forbidden);
        if (sprintId !== null && state.sprints?.has(sprintId) !== true) {
          return reject("not_found", `Sprint ${sprintId} does not exist.`);
        }
      }
      return Result.succeed({ ...base, type: "roadmap.item.updated", payload: command.patch });
    }

    case "roadmap.item.move": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const item = current.success;
      if (command.parentId !== item.parentId && item.source !== null) {
        // A new parent rewrites the sub-issue link on both issues involved.
        const before = item.parentId === null ? undefined : liveItem(item.parentId);
        const after = command.parentId === null ? undefined : liveItem(command.parentId);
        const locked = [item, before, after].find(
          (entry) =>
            entry !== undefined &&
            isReadOnly(entry, actor) &&
            (entry !== item ||
              (before?.source ?? null) !== null ||
              (after?.source ?? null) !== null),
        );
        if (locked !== undefined) return readOnlyRefusal(locked);
      }
      if (command.parentId !== null) {
        const parent = requireLive(command.parentId);
        if (Result.isFailure(parent)) return Result.fail(parent.failure);
        if (wouldCreateParentCycle(item.id, command.parentId, byId)) {
          return reject("parent_cycle", `${label(item)} cannot move under its own descendant.`);
        }
        const valid = requireParent(command.parentId, item.type);
        if (Result.isFailure(valid)) return Result.fail(valid.failure);
      }
      const siblings = siblingsOf(command.parentId, item.id);
      const requireSibling = (siblingId: RoadmapItemId) => {
        const index = siblings.findIndex((entry) => entry.id === siblingId);
        if (index !== -1) return Result.succeed(index);
        return Result.flatMap(requireLive(siblingId), (other) =>
          reject("invalid_parent", `${label(other)} is not a sibling at the destination.`),
        );
      };
      let previous: RoadmapWorkItem | undefined;
      let next: RoadmapWorkItem | undefined;
      if (command.afterId !== undefined) {
        const index = requireSibling(command.afterId);
        if (Result.isFailure(index)) return Result.fail(index.failure);
        previous = siblings[index.success];
        next = siblings[index.success + 1];
      }
      if (command.beforeId !== undefined) {
        const index = requireSibling(command.beforeId);
        if (Result.isFailure(index)) return Result.fail(index.failure);
        next = siblings[index.success];
        if (command.afterId === undefined) previous = siblings[index.success - 1];
      }
      if (command.afterId === undefined && command.beforeId === undefined) {
        previous = siblings.at(-1);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.item.moved",
        payload: {
          parentId: command.parentId,
          sortKey: sortKeyBetween(previous?.sortKey ?? null, next?.sortKey ?? null),
        },
      });
    }

    case "roadmap.item.delete": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const deletedIds: Array<RoadmapItemId> = [];
      const pending = [command.itemId];
      while (pending.length > 0) {
        const next = pending.shift()!;
        deletedIds.push(next);
        pending.push(...siblingsOf(next, next).map((child) => child.id));
      }
      return Result.succeed({ ...base, type: "roadmap.item.deleted", payload: { deletedIds } });
    }

    case "roadmap.item.restore": {
      const record = records.get(command.itemId);
      if (record === undefined) {
        return reject("not_found", `Work item ${command.itemId} does not exist.`);
      }
      const candidates = record.deletedAt === null ? [] : (state.lastDeletion ?? [command.itemId]);
      const restoredIds = candidates.filter(
        (itemId) => records.get(itemId)?.deletedAt !== null && records.has(itemId),
      );
      const restoring = new Set(restoredIds);
      for (const itemId of restoredIds) {
        const parentId = records.get(itemId)!.item.parentId;
        if (parentId === null || restoring.has(parentId)) continue;
        const parent = records.get(parentId);
        if (parent === undefined || parent.deletedAt !== null) {
          return reject(
            "deleted",
            `Restore the parent of ${label(records.get(itemId)!.item)} first.`,
          );
        }
      }
      return Result.succeed({ ...base, type: "roadmap.item.restored", payload: { restoredIds } });
    }

    case "roadmap.criteria.set": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.criteria.set",
        payload: { criteria: buildCriteria(command.criteria, current.success.criteria, eventId) },
      });
    }

    case "roadmap.criterion.tick": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const criterion = current.success.criteria.find((entry) => entry.id === command.criterionId);
      if (criterion === undefined) {
        return reject(
          "criterion_not_found",
          `${label(current.success)} has no criterion ${command.criterionId}.`,
        );
      }
      if (actor._tag === "steward") {
        const refused = stewardTickRefusal(command, criterion, state.criterionUntickedAt);
        if (refused !== undefined) return Result.fail(refused);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.criterion.ticked",
        payload: {
          criterionId: command.criterionId,
          ticked: command.ticked,
          evidence: command.ticked ? (command.evidence ?? null) : null,
        },
      });
    }

    case "roadmap.blocker.link": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (command.blockedById === command.itemId) {
        return reject("self_link", `${label(current.success)} cannot block itself.`);
      }
      const blocker = requireLive(command.blockedById);
      if (Result.isFailure(blocker)) return Result.fail(blocker.failure);
      if (isReadOnly(current.success, actor) && blocker.success.source !== null) {
        return readOnlyRefusal(current.success);
      }
      if (wouldCreateBlockerCycle(command.itemId, command.blockedById, byId)) {
        return reject(
          "blocker_cycle",
          `${label(blocker.success)} already waits on ${label(current.success)}.`,
        );
      }
      return Result.succeed({
        ...base,
        type: "roadmap.blocker.linked",
        payload: { blockedById: command.blockedById },
      });
    }

    case "roadmap.blocker.unlink": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (
        isReadOnly(current.success, actor) &&
        (records.get(command.blockedById)?.item.source ?? null) !== null
      ) {
        return readOnlyRefusal(current.success);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.blocker.unlinked",
        payload: { blockedById: command.blockedById },
      });
    }

    case "roadmap.external-blocker.add": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.external-blocker.added",
        payload: { blocker: { id: eventId, text: command.text, resolvedAt: null } },
      });
    }

    case "roadmap.external-blocker.resolve": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (!current.success.externalBlockers.some((blocker) => blocker.id === command.blockerId)) {
        return reject(
          "not_found",
          `${label(current.success)} has no external blocker ${command.blockerId}.`,
        );
      }
      return Result.succeed({
        ...base,
        type: "roadmap.external-blocker.resolved",
        payload: { blockerId: command.blockerId, resolved: command.resolved },
      });
    }

    case "roadmap.external-blocker.remove": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.external-blocker.removed",
        payload: { blockerId: command.blockerId },
      });
    }

    case "roadmap.related.link": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (command.relatedId === command.itemId) {
        return reject("self_link", `${label(current.success)} cannot relate to itself.`);
      }
      const related = requireLive(command.relatedId);
      if (Result.isFailure(related)) return Result.fail(related.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.related.linked",
        payload: { relatedId: command.relatedId },
      });
    }

    case "roadmap.related.unlink": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({
        ...base,
        type: "roadmap.related.unlinked",
        payload: { relatedId: command.relatedId },
      });
    }

    case "roadmap.thread.attach": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const other = attachedElsewhere(command.thread, command.itemId);
      if (other !== undefined) return alreadyAttached(other);
      return Result.succeed({
        ...base,
        type: "roadmap.thread.attached",
        payload: { thread: command.thread },
      });
    }

    case "roadmap.thread.detach": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (
        !current.success.attachments.some((attachment) =>
          sameThread(attachment.thread, command.thread),
        )
      ) {
        return reject("not_attached", `The thread is not attached to ${label(current.success)}.`);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.thread.detached",
        payload: { thread: command.thread },
      });
    }

    case "roadmap.item.mark-reviewed": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({ ...base, type: "roadmap.item.reviewed", payload: {} });
    }

    case "roadmap.item.pin": {
      const forbidden = userOnly(actor, "Today's picks");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const item = current.success;
      if (item.pinnedAt === null) {
        if (item.state === "done") {
          return reject("invalid_request", `${label(item)} is done, so it cannot be a pick.`);
        }
        const picks = liveItems().filter(
          (other) => other.pinnedAt !== null && other.state !== "done",
        );
        if (picks.length >= ROADMAP_PIN_LIMIT) {
          return reject(
            "pin_limit",
            `Today holds ${ROADMAP_PIN_LIMIT} picks. Unpin one of ${picks.map(label).join(", ")} first.`,
          );
        }
      }
      return Result.succeed({ ...base, type: "roadmap.item.pinned", payload: {} });
    }

    case "roadmap.item.unpin": {
      const forbidden = userOnly(actor, "Today's picks");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({ ...base, type: "roadmap.item.unpinned", payload: {} });
    }

    case "roadmap.item.snooze": {
      const forbidden = userOnly(actor, "snoozes");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (command.until <= earliestToday(input.now)) {
        return reject("invalid_request", `Snooze until a date after today, not ${command.until}.`);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.item.snoozed",
        payload: { until: command.until },
      });
    }

    case "roadmap.item.unsnooze": {
      const forbidden = userOnly(actor, "snoozes");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      return Result.succeed({ ...base, type: "roadmap.item.unsnoozed", payload: {} });
    }

    case "roadmap.hours.log": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (current.success.hours.some((entry) => entry.id === command.entryId)) {
        return reject(
          "already_exists",
          `${label(current.success)} already has hours entry ${command.entryId}.`,
        );
      }
      return Result.succeed({
        ...base,
        type: "roadmap.hours.logged",
        payload: {
          entry: {
            id: command.entryId,
            at: occurredAt,
            hours: command.hours,
            actor,
            note: command.note ?? null,
          },
        },
      });
    }

    case "roadmap.hours.remove": {
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (!current.success.hours.some((entry) => entry.id === command.entryId)) {
        return reject(
          "not_found",
          `${label(current.success)} has no hours entry ${command.entryId}.`,
        );
      }
      return Result.succeed({
        ...base,
        type: "roadmap.hours.removed",
        payload: { entryId: command.entryId },
      });
    }

    case "roadmap.note.add": {
      const forbidden = noteKindForbidden(actor, command.kind);
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      const item = current.success;
      if (item.progressNotes.some((note) => note.id === command.noteId)) {
        return reject("already_exists", `${label(item)} already has note ${command.noteId}.`);
      }
      const criterionId = command.criterionId ?? null;
      if (
        criterionId !== null &&
        !item.criteria.some((criterion) => criterion.id === criterionId)
      ) {
        return reject("criterion_not_found", `${label(item)} has no criterion ${criterionId}.`);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.note.added",
        payload: {
          note: {
            id: command.noteId,
            at: occurredAt,
            actor,
            kind: command.kind,
            text: command.text,
            criterionId,
          },
        },
      });
    }

    case "roadmap.note.remove": {
      const forbidden = userOnly(actor, "notes");
      if (forbidden !== undefined) return Result.fail(forbidden);
      const current = requireLive(command.itemId);
      if (Result.isFailure(current)) return Result.fail(current.failure);
      if (!current.success.progressNotes.some((note) => note.id === command.noteId)) {
        return reject("not_found", `${label(current.success)} has no note ${command.noteId}.`);
      }
      return Result.succeed({
        ...base,
        type: "roadmap.note.removed",
        payload: { noteId: command.noteId },
      });
    }
  }
}

/**
 * The steward ticks open criteria with evidence and nothing more. Once someone
 * unticks a criterion, its old evidence was judged wrong, so a new tick must
 * cite a turn that ended after the untick.
 */
function stewardTickRefusal(
  command: Extract<RoadmapCommand, { readonly type: "roadmap.criterion.tick" }>,
  criterion: RoadmapCriterion,
  untickedAt: IsoDateTime | undefined,
): RoadmapError | undefined {
  if (!command.ticked) {
    return new RoadmapError({
      code: "forbidden_actor",
      message: "The steward cannot untick a criterion.",
    });
  }
  if (criterion.tickedAt !== null) {
    return new RoadmapError({
      code: "forbidden_actor",
      message: `Criterion ${criterion.id} is already ticked; the steward leaves it alone.`,
    });
  }
  if ((command.evidence ?? "").trim().length === 0) {
    return new RoadmapError({
      code: "invalid_request",
      message: "The steward must give evidence for a tick.",
    });
  }
  if (
    untickedAt !== undefined &&
    // Written as "not newer" so an unparseable time counts as stale.
    !(
      command.evidenceAfter !== undefined &&
      Date.parse(command.evidenceAfter) > Date.parse(untickedAt)
    )
  ) {
    return new RoadmapError({
      code: "stale_evidence",
      message: `Criterion ${criterion.id} was unticked after the turn this evidence cites.`,
    });
  }
  return undefined;
}

/**
 * Agents and the user report progress. Sync notes record what GitHub changed
 * and drift and unsure notes are the steward's judgement, so only that actor
 * may write them.
 */
function noteKindForbidden(actor: RoadmapActor, kind: RoadmapNoteKind) {
  const owner =
    kind === "sync" ? "github" : kind === "drift" || kind === "unsure" ? "steward" : null;
  return owner === null || owner === actor._tag
    ? undefined
    : new RoadmapError({
        code: "forbidden_actor",
        message: `Only ${owner === "github" ? "GitHub" : "the steward"} can add ${kind} notes.`,
      });
}

function planSprintCommand(input: {
  readonly command: RoadmapSprintCommand;
  readonly actor: RoadmapActor;
  readonly state: RoadmapCommandState;
  readonly eventId: EventId;
  readonly now: DateTime.Utc;
}): Result.Result<RoadmapSprintEvent, RoadmapError> {
  const { command, actor, state, eventId } = input;
  const forbidden = userOnly(actor, "sprints");
  if (forbidden !== undefined) return Result.fail(forbidden);
  const base = {
    eventId,
    sprintId: command.sprintId,
    actor,
    occurredAt: DateTime.formatIso(input.now),
  };
  const sprints = state.sprints ?? new Map<RoadmapSprintId, RoadmapSprint>();
  const existing = sprints.get(command.sprintId);
  const missing = () => reject("not_found", `Sprint ${command.sprintId} does not exist.`);
  const endsFirst = (startDate: string, endDate: string) =>
    endDate < startDate
      ? reject(
          "invalid_request",
          `A sprint cannot end (${endDate}) before it starts (${startDate}).`,
        )
      : undefined;

  switch (command.type) {
    case "roadmap.sprint.create": {
      if (existing !== undefined) {
        return reject("already_exists", `Sprint ${command.sprintId} already exists.`);
      }
      const invalid = endsFirst(command.startDate, command.endDate);
      if (invalid !== undefined) return invalid;
      return Result.succeed({
        ...base,
        type: "roadmap.sprint.created",
        payload: {
          sprint: {
            id: command.sprintId,
            name: command.name,
            area: command.area,
            startDate: command.startDate,
            endDate: command.endDate,
          },
        },
      });
    }

    case "roadmap.sprint.update": {
      if (existing === undefined) return missing();
      const next = { ...existing, ...command.patch };
      const invalid = endsFirst(next.startDate, next.endDate);
      if (invalid !== undefined) return invalid;
      return Result.succeed({ ...base, type: "roadmap.sprint.updated", payload: command.patch });
    }

    case "roadmap.sprint.delete": {
      if (existing === undefined) return missing();
      // Deleted items too, so restoring one never brings back a dangling sprint.
      const clearedItemIds = [...state.items.values()].flatMap((record) =>
        record.item.sprintId === command.sprintId ? [record.item.id] : [],
      );
      return Result.succeed({
        ...base,
        type: "roadmap.sprint.deleted",
        payload: { clearedItemIds },
      });
    }
  }
}

function lastUserRootArea(items: ReadonlyArray<RoadmapWorkItem>): RoadmapArea {
  let latest: RoadmapWorkItem | undefined;
  for (const item of items) {
    if (item.parentId !== null || item.createdBy._tag !== "user") continue;
    if (latest === undefined || item.createdAt > latest.createdAt) latest = item;
  }
  return latest?.area ?? DEFAULT_ROADMAP_AREA;
}

/**
 * The records an accepted event changes, given a lookup of the current ones.
 * Unknown ids are skipped, so replaying a stream with gaps never fails.
 */
export function projectRoadmapEvent(
  lookup: (itemId: RoadmapItemId) => RoadmapItemRecord | undefined,
  event: RoadmapItemEvent,
): ReadonlyArray<RoadmapItemRecord> {
  const at = event.occurredAt;
  if (event.type === "roadmap.item.created") {
    return [{ item: event.payload.item, deletedAt: null }];
  }
  if (event.type === "roadmap.item.deleted" || event.type === "roadmap.item.restored") {
    const ids =
      event.type === "roadmap.item.deleted" ? event.payload.deletedIds : event.payload.restoredIds;
    return ids.flatMap((itemId) => {
      const record = lookup(itemId);
      if (record === undefined) return [];
      return [
        {
          item: { ...record.item, updatedAt: at },
          deletedAt: event.type === "roadmap.item.deleted" ? at : null,
        },
      ];
    });
  }
  const record = lookup(event.itemId);
  if (record === undefined) return [];
  const item = record.item;
  const withoutId = <A>(values: ReadonlyArray<A>, value: A) =>
    values.filter((entry) => entry !== value);
  // Sync compares these times with the issue's to settle a conflict, so only
  // changes made here count; GitHub's own arrive already agreed.
  const localChange = (
    fields: ReadonlyArray<keyof RoadmapIssueLocalChanges>,
  ): Partial<Pick<RoadmapWorkItem, "source">> => {
    if (item.source === null || event.actor._tag === "github" || fields.length === 0) return {};
    const localChangedAt = { ...item.source.localChangedAt };
    for (const field of fields) localChangedAt[field] = at;
    return { source: { ...item.source, localChangedAt } };
  };
  const next = ((): RoadmapWorkItem => {
    switch (event.type) {
      case "roadmap.item.updated": {
        const state = event.payload.state;
        const stateChanged = state !== undefined && state !== item.state;
        const title = event.payload.title;
        return {
          ...item,
          ...event.payload,
          needsReview: event.actor._tag === "user" ? false : item.needsReview,
          ...(stateChanged
            ? {
                stateChangedAt: at,
                completedAt: state === "done" ? at : null,
                // A finished pick frees its slot on Today.
                ...(state === "done" ? { pinnedAt: null } : {}),
              }
            : {}),
          ...localChange([
            ...(title !== undefined && title !== item.title ? (["title"] as const) : []),
            ...(stateChanged && (state === "done") !== (item.state === "done")
              ? (["closed"] as const)
              : []),
          ]),
        };
      }
      case "roadmap.item.moved":
        return {
          ...item,
          parentId: event.payload.parentId,
          sortKey: event.payload.sortKey,
          ...localChange(event.payload.parentId === item.parentId ? [] : ["parent"]),
        };
      case "roadmap.criteria.set":
        return { ...item, criteria: event.payload.criteria };
      case "roadmap.criterion.ticked":
        return {
          ...item,
          criteria: item.criteria.map((criterion) =>
            criterion.id !== event.payload.criterionId
              ? criterion
              : event.payload.ticked
                ? {
                    ...criterion,
                    tickedAt: at,
                    tickedBy: event.actor,
                    evidence: event.payload.evidence,
                  }
                : { ...criterion, tickedAt: null, tickedBy: null, evidence: null },
          ),
        };
      case "roadmap.blocker.linked":
        return {
          ...item,
          blockedBy: [
            ...withoutId(item.blockedBy, event.payload.blockedById),
            event.payload.blockedById,
          ],
          ...localChange(item.blockedBy.includes(event.payload.blockedById) ? [] : ["blockedBy"]),
        };
      case "roadmap.blocker.unlinked":
        return {
          ...item,
          blockedBy: withoutId(item.blockedBy, event.payload.blockedById),
          ...localChange(item.blockedBy.includes(event.payload.blockedById) ? ["blockedBy"] : []),
        };
      case "roadmap.external-blocker.added":
        return { ...item, externalBlockers: [...item.externalBlockers, event.payload.blocker] };
      case "roadmap.external-blocker.resolved":
        return {
          ...item,
          externalBlockers: item.externalBlockers.map((blocker) =>
            blocker.id === event.payload.blockerId
              ? { ...blocker, resolvedAt: event.payload.resolved ? at : null }
              : blocker,
          ),
        };
      case "roadmap.external-blocker.removed":
        return {
          ...item,
          externalBlockers: item.externalBlockers.filter(
            (blocker) => blocker.id !== event.payload.blockerId,
          ),
        };
      case "roadmap.related.linked":
        return {
          ...item,
          related: [...withoutId(item.related, event.payload.relatedId), event.payload.relatedId],
        };
      case "roadmap.related.unlinked":
        return { ...item, related: withoutId(item.related, event.payload.relatedId) };
      case "roadmap.thread.attached":
        return item.attachments.some((attachment) =>
          sameThread(attachment.thread, event.payload.thread),
        )
          ? item
          : {
              ...item,
              attachments: [...item.attachments, { thread: event.payload.thread, attachedAt: at }],
            };
      case "roadmap.thread.detached":
        return {
          ...item,
          attachments: item.attachments.filter(
            (attachment) => !sameThread(attachment.thread, event.payload.thread),
          ),
        };
      case "roadmap.item.reviewed":
        return { ...item, needsReview: false };
      case "roadmap.item.pinned":
        return item.pinnedAt === null ? { ...item, pinnedAt: at } : item;
      case "roadmap.item.unpinned":
        return { ...item, pinnedAt: null };
      case "roadmap.item.snoozed":
        return { ...item, snoozedUntil: event.payload.until };
      case "roadmap.item.unsnoozed":
        return { ...item, snoozedUntil: null };
      case "roadmap.hours.logged":
        return item.hours.some((entry) => entry.id === event.payload.entry.id)
          ? item
          : { ...item, hours: [...item.hours, event.payload.entry] };
      case "roadmap.hours.removed":
        return {
          ...item,
          hours: item.hours.filter((entry) => entry.id !== event.payload.entryId),
        };
      case "roadmap.note.added":
        return item.progressNotes.some((note) => note.id === event.payload.note.id)
          ? item
          : {
              ...item,
              progressNotes: [...item.progressNotes, event.payload.note].slice(-ROADMAP_NOTE_LIMIT),
            };
      case "roadmap.note.removed":
        return {
          ...item,
          progressNotes: item.progressNotes.filter((note) => note.id !== event.payload.noteId),
        };
      case "roadmap.source.synced":
        return item.source === null
          ? item
          : {
              ...item,
              source: {
                ...item.source,
                writable: event.payload.writable,
                remoteUpdatedAt: event.payload.remoteUpdatedAt,
                syncedAt: event.payload.syncedAt,
                base: event.payload.base,
              },
            };
      case "roadmap.source.unlinked":
        return { ...item, source: null };
      case "roadmap.pull-request.linked": {
        const link = event.payload.pullRequest;
        return {
          ...item,
          pullRequests: [
            ...item.pullRequests.filter((entry) => !samePullRequest(entry, link)),
            link,
          ],
        };
      }
      case "roadmap.pull-request.unlinked":
        return {
          ...item,
          pullRequests: item.pullRequests.filter((entry) => !samePullRequest(entry, event.payload)),
        };
    }
  })();
  return [{ item: { ...next, updatedAt: at }, deletedAt: record.deletedAt }];
}

/**
 * The sprints and items a sprint event changes. A delete also takes the sprint
 * off every item it names, deleted ones included.
 */
export function projectRoadmapSprintEvent(
  lookup: {
    readonly item: (itemId: RoadmapItemId) => RoadmapItemRecord | undefined;
    readonly sprint: (sprintId: RoadmapSprintId) => RoadmapSprint | undefined;
  },
  event: RoadmapSprintEvent,
): {
  readonly sprints: ReadonlyArray<RoadmapSprintChange>;
  readonly items: ReadonlyArray<RoadmapItemRecord>;
} {
  switch (event.type) {
    case "roadmap.sprint.created":
      return { sprints: [{ sprint: event.payload.sprint, removed: false }], items: [] };
    case "roadmap.sprint.updated": {
      const current = lookup.sprint(event.sprintId);
      if (current === undefined) return { sprints: [], items: [] };
      return { sprints: [{ sprint: { ...current, ...event.payload }, removed: false }], items: [] };
    }
    case "roadmap.sprint.deleted": {
      const current = lookup.sprint(event.sprintId);
      const items = event.payload.clearedItemIds.flatMap((itemId) => {
        const record = lookup.item(itemId);
        if (record === undefined) return [];
        return [
          {
            item: { ...record.item, sprintId: null, updatedAt: event.occurredAt },
            deletedAt: record.deletedAt,
          },
        ];
      });
      return { sprints: current === undefined ? [] : [{ sprint: current, removed: true }], items };
    }
  }
}
