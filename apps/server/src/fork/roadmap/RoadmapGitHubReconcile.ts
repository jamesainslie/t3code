/**
 * Fork: roadmap. The pure half of GitHub sync: given an item, its issue as
 * GitHub shows it now, and where the two agreed at the last sync, decide what
 * changes here, what is pushed to GitHub, and the new agreement. Nothing here
 * does I/O.
 *
 * A field that moved on one side only is copied to the other. One that moved
 * on both sides to different values is a conflict, and the newer change wins
 * with a sync note. Parent and blockers count only issues that are themselves
 * items ("known"): GitHub links to anything else stay on GitHub.
 */
import type {
  RoadmapArea,
  RoadmapIssueSyncBase,
  RoadmapItemId,
  RoadmapItemState,
  RoadmapItemType,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { canParent, effectiveArea, wouldCreateParentCycle } from "@lathe/shared/roadmap";
import type { GitHubIssue } from "@lathe/source-control-github/server/GitHubIssueApi";

export type LocalIssueChange =
  | { readonly kind: "title"; readonly title: string }
  | { readonly kind: "state"; readonly state: RoadmapItemState }
  | {
      readonly kind: "move";
      readonly parentId: RoadmapItemId | null;
      /** Set when the item's type cannot sit under its new parent. */
      readonly itemType?: RoadmapItemType;
      /** Set on a move to the top level, so the item keeps the area it inherited. */
      readonly area?: RoadmapArea;
    }
  | { readonly kind: "blocker"; readonly blockedById: RoadmapItemId; readonly linked: boolean };

export type RemoteIssueChange =
  | { readonly kind: "title"; readonly title: string }
  | { readonly kind: "closed"; readonly closed: boolean }
  | {
      readonly kind: "parent";
      readonly parentNodeId: string | null;
      readonly previousParentNodeId: string | null;
    }
  | { readonly kind: "blocker"; readonly blockingNodeId: string; readonly blocked: boolean };

export interface IssueSyncNote {
  /** Stable for one decision, so a retried sweep does not write the note twice. */
  readonly key: string;
  readonly text: string;
}

export interface IssueReconciliation {
  readonly local: ReadonlyArray<LocalIssueChange>;
  readonly remote: ReadonlyArray<RemoteIssueChange>;
  readonly notes: ReadonlyArray<IssueSyncNote>;
  /** The agreement to record once every change above has landed. */
  readonly base: RoadmapIssueSyncBase;
  /** Sub-issues GitHub shows that no item holds, to import under this item. */
  readonly newSubIssues: ReadonlyArray<string>;
}

/**
 * The type an issue takes under `parentType`: the highest of epic, feature
 * and story that fits for an issue with sub-issues, a story for one without,
 * and a bug where a story cannot go. Null when nothing fits.
 */
export function issueItemType(
  parentType: RoadmapItemType | null,
  hasSubIssues: boolean,
): RoadmapItemType | null {
  const candidates: ReadonlyArray<RoadmapItemType> = hasSubIssues
    ? ["epic", "feature", "story", "bug"]
    : ["story", "bug"];
  return candidates.find((type) => parentType === null || canParent(parentType, type)) ?? null;
}

const issueLabel = (remote: GitHubIssue) => `#${remote.number}`;

const newer = (local: string | null, remote: string) =>
  local !== null && Date.parse(local) > Date.parse(remote);

export function reconcileIssue(input: {
  readonly item: RoadmapWorkItem;
  readonly remote: GitHubIssue;
  /** Live items by id. */
  readonly items: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>;
  /** Live issue-backed items by their issue's node id. */
  readonly byNodeId: ReadonlyMap<string, RoadmapWorkItem>;
  /** Every issue an item holds or held, deleted items included, so none is imported again. */
  readonly knownNodeIds: ReadonlySet<string>;
}): IssueReconciliation {
  const { item, remote, items, byNodeId } = input;
  const source = item.source;
  if (source === null) {
    return {
      local: [],
      remote: [],
      notes: [],
      base: { title: item.title, closed: false, parentNodeId: null, blockedByNodeIds: [] },
      newSubIssues: [],
    };
  }
  const base = source.base;
  const writable = remote.writable;
  const local: Array<LocalIssueChange> = [];
  const pushes: Array<RemoteIssueChange> = [];
  const notes: Array<IssueSyncNote> = [];
  const note = (field: string, text: string) =>
    notes.push({ key: `${remote.updatedAt}:${field}:${text}`, text });
  const readOnlyReason = `this environment's GitHub account cannot change issue ${issueLabel(remote)}`;

  // Title.
  let title = base.title;
  {
    const remoteChanged = remote.title !== base.title;
    const localChanged = item.title !== base.title;
    if (remoteChanged && !localChanged) {
      title = remote.title;
      local.push({ kind: "title", title });
    } else if (localChanged && (!remoteChanged || remote.title === item.title)) {
      if (remote.title === item.title) {
        title = item.title;
      } else if (writable) {
        title = item.title;
        pushes.push({ kind: "title", title });
      } else {
        title = remote.title;
        local.push({ kind: "title", title });
        note(
          "title",
          `GitHub's title "${remote.title}" replaced "${item.title}": ${readOnlyReason}.`,
        );
      }
    } else if (remoteChanged && localChanged) {
      if (writable && newer(source.localChangedAt.title, remote.updatedAt)) {
        title = item.title;
        pushes.push({ kind: "title", title });
        note(
          "title",
          `Kept "${item.title}" over GitHub's title "${remote.title}", which was older.`,
        );
      } else {
        title = remote.title;
        local.push({ kind: "title", title });
        note(
          "title",
          `GitHub's title "${remote.title}" replaced "${item.title}", which was older.`,
        );
      }
    }
  }

  // Open or closed. Both sides changing can only agree, since there are two values.
  let closed = base.closed;
  {
    const localClosed = item.state === "done";
    const remoteChanged = remote.closed !== base.closed;
    const localChanged = localClosed !== base.closed;
    const stateFor = (isClosed: boolean): RoadmapItemState => (isClosed ? "done" : "in-progress");
    if (remoteChanged) {
      closed = remote.closed;
      if (!localChanged) local.push({ kind: "state", state: stateFor(remote.closed) });
    } else if (localChanged) {
      if (writable) {
        closed = localClosed;
        pushes.push({ kind: "closed", closed });
      } else {
        local.push({ kind: "state", state: stateFor(remote.closed) });
        note(
          "closed",
          `GitHub still has issue ${issueLabel(remote)} ${remote.closed ? "closed" : "open"}: ${readOnlyReason}.`,
        );
      }
    }
  }

  // Parent, in known terms.
  let parentNodeId = base.parentNodeId;
  {
    const remoteParent =
      remote.parentNodeId !== null && byNodeId.has(remote.parentNodeId)
        ? remote.parentNodeId
        : null;
    const localParentItem = item.parentId === null ? undefined : items.get(item.parentId);
    const localParent = localParentItem?.source?.nodeId ?? null;
    const remoteChanged = remoteParent !== base.parentNodeId;
    const localChanged = localParent !== base.parentNodeId;

    const followRemote = (why: string | null) => {
      const target = remoteParent === null ? null : byNodeId.get(remoteParent)!;
      if (target !== null && wouldCreateParentCycle(item.id, target.id, items)) {
        note(
          "parent",
          `Could not move under ${target.type} "${target.title}" as GitHub has it: that item sits under this one.`,
        );
        return;
      }
      let itemType: RoadmapItemType | undefined;
      if (target !== null && !canParent(target.type, item.type)) {
        const hasChildren = [...items.values()].some((other) => other.parentId === item.id);
        const fitted = issueItemType(target.type, hasChildren);
        if (fitted === null) {
          note(
            "parent",
            `Could not move under ${target.type} "${target.title}" as GitHub has it: a ${target.type} holds no sub-items.`,
          );
          return;
        }
        itemType = fitted;
      }
      parentNodeId = remoteParent;
      local.push({
        kind: "move",
        parentId: target?.id ?? null,
        ...(itemType === undefined ? {} : { itemType }),
        ...(target === null && localParentItem !== undefined
          ? { area: effectiveArea(item.id, items).area }
          : {}),
      });
      if (why !== null) note("parent", why);
    };
    const pushLocal = () => {
      parentNodeId = localParent;
      pushes.push({
        kind: "parent",
        parentNodeId: localParent,
        previousParentNodeId: remote.parentNodeId,
      });
      if (localParent === null && remote.parentNodeId !== null) {
        const previous = byNodeId.get(remote.parentNodeId);
        note(
          "parent",
          `Dropped the sub-issue link to ${previous === undefined ? "its parent issue" : `"${previous.title}"`}, because this item no longer sits under an issue.`,
        );
      }
    };

    if (remoteChanged && !localChanged) {
      followRemote(null);
    } else if (localChanged && !remoteChanged) {
      if (writable) pushLocal();
      else followRemote(`Moved back under its parent on GitHub: ${readOnlyReason}.`);
    } else if (remoteChanged && localChanged) {
      if (remoteParent === localParent) parentNodeId = localParent;
      else if (writable && newer(source.localChangedAt.parent, remote.updatedAt)) {
        pushLocal();
        note("parent", "Kept the parent chosen here over GitHub's, which was older.");
      } else {
        followRemote("Moved to the parent GitHub has, as the change on GitHub was newer.");
      }
    }
  }

  // Blockers, in known terms, one issue at a time. A set cannot conflict:
  // where the sides differ, exactly one moved from the agreement.
  const blockedBy = new Set<string>();
  {
    const remoteSet = new Set(remote.blockedByNodeIds.filter((nodeId) => byNodeId.has(nodeId)));
    const localSet = new Set(
      item.blockedBy.flatMap((blockerId) => {
        const nodeId = items.get(blockerId)?.source?.nodeId;
        return nodeId === undefined ? [] : [nodeId];
      }),
    );
    const baseSet = new Set(base.blockedByNodeIds.filter((nodeId) => byNodeId.has(nodeId)));
    for (const nodeId of new Set([...remoteSet, ...localSet, ...baseSet])) {
      const inRemote = remoteSet.has(nodeId);
      const inLocal = localSet.has(nodeId);
      if (inRemote === inLocal) {
        if (inRemote) blockedBy.add(nodeId);
        continue;
      }
      const localMoved = inLocal !== baseSet.has(nodeId);
      if (localMoved && writable) {
        if (inLocal) blockedBy.add(nodeId);
        pushes.push({ kind: "blocker", blockingNodeId: nodeId, blocked: inLocal });
      } else {
        if (inRemote) blockedBy.add(nodeId);
        local.push({ kind: "blocker", blockedById: byNodeId.get(nodeId)!.id, linked: inRemote });
      }
    }
  }

  return {
    local,
    remote: pushes,
    notes,
    base: { title, closed, parentNodeId, blockedByNodeIds: [...blockedBy].sort() },
    newSubIssues: remote.subIssueNodeIds.filter((nodeId) => !input.knownNodeIds.has(nodeId)),
  };
}
