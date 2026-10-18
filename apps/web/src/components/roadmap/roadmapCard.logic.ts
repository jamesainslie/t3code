/**
 * Fork: roadmap. Pure rules behind the Roadmap card on the thread view.
 */
import type {
  RoadmapActor,
  RoadmapItemId,
  RoadmapThreadRef,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { attachedItemFor } from "@lathe/client-runtime/roadmap/tree";

/** The item's ancestors from the root down; stops at a missing parent or a corrupt loop. */
export function parentPath(
  item: RoadmapWorkItem,
  byId: ReadonlyMap<RoadmapItemId, RoadmapWorkItem>,
): ReadonlyArray<RoadmapWorkItem> {
  const path: RoadmapWorkItem[] = [];
  const seen = new Set<RoadmapItemId>([item.id]);
  let parentId = item.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    seen.add(parentId);
    path.unshift(parent);
    parentId = parent.parentId;
  }
  return path;
}

/** Items waiting on this one: the reverse of `blockedBy`. */
export function blocksOf(
  item: RoadmapWorkItem,
  items: ReadonlyArray<RoadmapWorkItem>,
): ReadonlyArray<RoadmapWorkItem> {
  return items.filter((other) => other.blockedBy.includes(item.id));
}

export function roadmapActorLabel(actor: RoadmapActor): string {
  switch (actor._tag) {
    case "user":
      return "You";
    case "agent":
      return actor.threadTitle;
    case "steward":
      return "Steward";
    case "github":
      return "GitHub";
  }
}

/**
 * Whether the card is open: the user's own choice for this thread once made,
 * otherwise open exactly when the thread is on the roadmap.
 */
export function roadmapCardOpen(override: boolean | null, attached: boolean): boolean {
  return override ?? attached;
}

export type RoadmapCardView =
  | { readonly kind: "hidden" }
  | { readonly kind: "offline" }
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "attached"; readonly item: RoadmapWorkItem };

export function roadmapCardView(input: {
  /** The home advertises a roadmap. */
  readonly supported: boolean;
  readonly homeConnected: boolean;
  /** The thread lives on the home, so a disconnected home is a disconnected thread too. */
  readonly threadOnHome: boolean;
  /** The home's items, or null until the first snapshot arrives. */
  readonly items: ReadonlyArray<RoadmapWorkItem> | null;
  readonly thread: RoadmapThreadRef;
}): RoadmapCardView {
  if (!input.supported) return { kind: "hidden" };
  if (!input.threadOnHome && !input.homeConnected) return { kind: "offline" };
  if (input.items === null) return { kind: "loading" };
  const item = attachedItemFor(input.items, input.thread);
  return item === null ? { kind: "empty" } : { kind: "attached", item };
}
