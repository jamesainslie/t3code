/**
 * Fork: roadmap. The command palette's roadmap actions and its work item
 * picker, which attaches a thread to an item.
 */
import type { ScopedThreadRef } from "@lathe/contracts";
import { attachedItemFor } from "@lathe/client-runtime/roadmap/tree";
import { useRouter } from "@tanstack/react-router";
import { LinkIcon, MapIcon, PlusIcon, UnlinkIcon } from "lucide-react";
import { useMemo } from "react";

import { useRoadmapLive } from "../../state/roadmap";
import {
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
} from "../CommandPalette.logic";
import {
  attachPickerGroups,
  roadmapHref,
  ROADMAP_ITEM_TYPE_LABELS,
  ROADMAP_PRIORITY_LABELS,
} from "./roadmapThread.logic";
import { useRoadmapThreadActions, type RoadmapThreadTarget } from "./useRoadmapThreadActions";

/** The pushed view's group value; the palette swaps in the live groups for it. */
export const ROADMAP_ATTACH_VIEW = "roadmap-attach";

/**
 * The picker's groups for a thread, rebuilt from the live roadmap so items
 * that change while the picker is open are never stale.
 */
export function useRoadmapAttachPickerGroups(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<CommandPaletteGroup> {
  const router = useRouter();
  const { availability, actions } = useRoadmapThreadActions();
  const live = useRoadmapLive(
    threadRef !== null && availability.supported ? availability.home : null,
  );
  const items = live.data?.items ?? null;
  return useMemo(() => {
    if (threadRef === null || items === null) return [];
    const groups = attachPickerGroups(items, { excludeAttachedTo: threadRef });
    if (groups.length === 0) {
      return [
        {
          value: "roadmap-attach:empty",
          label: "Attach to work item",
          items: [
            {
              kind: "action",
              value: "roadmap-attach:new",
              title: "No work items yet. Create one",
              searchTerms: ["create", "new", "work item"],
              icon: <PlusIcon className={ITEM_ICON_CLASS} />,
              run: async () => {
                await router.navigate({ href: roadmapHref({ new: true }) });
              },
            },
          ],
        },
      ];
    }
    return groups.map((group) => ({
      value: `roadmap-attach:${group.objectiveId ?? "none"}`,
      label: group.label,
      items: group.entries.map((entry): CommandPaletteActionItem => ({
        kind: "action",
        value: `roadmap-item:${entry.item.id}`,
        title: entry.item.title,
        description: [
          `${ROADMAP_ITEM_TYPE_LABELS[entry.item.type]}, ${ROADMAP_PRIORITY_LABELS[entry.priority.priority]}`,
          ...(entry.depth > 0 ? [entry.path.join(" › ")] : []),
        ].join(" · "),
        searchTerms: [entry.item.title, ROADMAP_ITEM_TYPE_LABELS[entry.item.type]],
        icon: <MapIcon className={ITEM_ICON_CLASS} />,
        run: () => actions.attach(threadRef, entry.item),
      })),
    }));
  }, [actions, items, router, threadRef]);
}

/**
 * Root palette actions: open the Roadmap, create an item, and attach or
 * detach the thread on screen.
 */
export function useRoadmapPaletteActionItems(input: {
  readonly activeThread: RoadmapThreadTarget | null;
  readonly onAttach: (threadRef: ScopedThreadRef) => void;
}): ReadonlyArray<CommandPaletteActionItem> {
  const router = useRouter();
  const { availability, actions } = useRoadmapThreadActions();
  const live = useRoadmapLive(availability.supported ? availability.home : null);
  const items = live.data?.items ?? null;
  const { activeThread, onAttach } = input;
  if (!availability.supported) return [];
  const threadRef =
    activeThread === null
      ? null
      : { environmentId: activeThread.environmentId, threadId: activeThread.id };
  const attached = threadRef === null || items === null ? null : attachedItemFor(items, threadRef);
  const result: CommandPaletteActionItem[] = [
    {
      kind: "action",
      value: "action:roadmap",
      searchTerms: ["roadmap", "work items", "objectives", "plan", "outline", "board"],
      title: "Open roadmap",
      icon: <MapIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "roadmap.open",
      run: async () => {
        await router.navigate({ href: roadmapHref() });
      },
    },
  ];
  if (!availability.canChange) return result;
  result.push({
    kind: "action",
    value: "action:roadmap-create",
    searchTerms: ["create work item", "new work item", "roadmap", "objective", "epic", "story"],
    title: "Create work item",
    ...(attached === null ? {} : { description: `Under ${attached.title}` }),
    icon: <PlusIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await router.navigate({ href: roadmapHref({ new: true, parent: attached?.id ?? null }) });
    },
  });
  if (activeThread !== null && threadRef !== null && items !== null) {
    result.push(
      attached === null
        ? {
            kind: "action",
            value: "action:roadmap-attach",
            searchTerms: ["attach thread", "work item", "roadmap"],
            title: "Attach this thread to a work item",
            icon: <LinkIcon className={ITEM_ICON_CLASS} />,
            keepOpen: true,
            run: async () => onAttach(threadRef),
          }
        : {
            kind: "action",
            value: "action:roadmap-detach",
            searchTerms: ["detach thread", "work item", "roadmap"],
            title: "Detach this thread",
            description: `From ${attached.title}`,
            icon: <UnlinkIcon className={ITEM_ICON_CLASS} />,
            run: () => actions.detach(threadRef),
          },
    );
  }
  return result;
}
