/**
 * Fork: roadmap. The Roadmap card on the thread view and its header trigger.
 * The card stacks under the Iris card in the thread details column and, with
 * no room for that column, opens over the chat on request, as the Iris card
 * does.
 */
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { RoadmapSprint } from "@lathe/contracts";
import { scopedThreadKey, scopeThreadRef } from "@lathe/client-runtime/environment";
import { MapIcon } from "lucide-react";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { openRoadmapAttachPicker } from "../../commandPaletteBus";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useRoadmapAreaSettings, useRoadmapLive } from "../../state/roadmap";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsColumnResizeHandle } from "../chat/threadDetailsColumnWidth";
import type { SideCardPlacement } from "../chat/threadSideCardLayout";
import {
  measureThreadSideCard,
  useThreadSideCardPlacement,
} from "../chat/useThreadSideCardPlacement";
import { RoadmapCardBody } from "./RoadmapCardBody";
import { roadmapCardOpen, roadmapCardView } from "./roadmapCard.logic";
import { useRoadmapThreadActions, type RoadmapThreadTarget } from "./useRoadmapThreadActions";

const EMPTY_SPRINTS: ReadonlyArray<RoadmapSprint> = [];
/** One choice for every thread's card, kept across reloads. */
const ROADMAP_CARD_MINIMIZED_STORAGE_KEY = "lathe:roadmap-card-minimized";

/**
 * The user's open or closed choice for a thread's card; null until they make
 * one, so the card follows whether the thread is attached. It lasts the
 * session, so switching threads and back keeps the choice.
 */
const roadmapCardOpenOverrideAtom = Atom.family((threadKey: string) =>
  Atom.make<boolean | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel(`roadmap:card-open:${threadKey}`),
  ),
);

/** The portal shell, placed like the Iris card and marked so the stack can measure it. */
function RoadmapCard({
  placement,
  onClose,
  children,
}: {
  readonly placement: SideCardPlacement;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  // Only a popover takes Escape: inline, the card is part of the column and
  // Escape belongs to the chat (stopping a turn, closing other overlays).
  useEffect(() => {
    if (placement.mode !== "popover") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, placement.mode]);

  return createPortal(
    <section
      aria-label="Roadmap"
      className="dropdown-glass fixed isolate z-40 grid grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl"
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
      data-roadmap-card={placement.mode}
      data-thread-side-card="roadmap"
    >
      <ScrollArea scrollFade className="min-h-0">
        {children}
      </ScrollArea>
      <ThreadDetailsColumnResizeHandle width={placement.width} maxWidth={placement.maxWidth} />
    </section>,
    document.body,
  );
}

/**
 * The header trigger and the card it opens, for a thread that exists on its
 * server. Renders nothing unless the roadmap home serves a roadmap.
 */
export function RoadmapCardControl({ thread }: { readonly thread: RoadmapThreadTarget }) {
  const { availability, actions } = useRoadmapThreadActions();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const live = useRoadmapLive(availability.supported ? availability.home : null);
  const areaSettings = useRoadmapAreaSettings(availability.home);
  const items = live.data?.items ?? null;
  const view = roadmapCardView({
    supported: availability.supported,
    homeConnected: availability.homeConnected,
    threadOnHome: availability.home === thread.environmentId,
    items,
    thread: threadRef,
  });
  const [minimized, setMinimized] = useLocalStorage(
    ROADMAP_CARD_MINIMIZED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const override = useAtomValue(roadmapCardOpenOverrideAtom(threadKey));
  const setOverride = useAtomSet(roadmapCardOpenOverrideAtom(threadKey));
  const requested = roadmapCardOpen(override, view.kind === "attached");
  // Same room rules as the Iris card: inline while the column has room,
  // otherwise only on request, over the chat, until closed or room returns.
  const [popoverRequested, setPopoverRequested] = useState(false);
  const placement = useThreadSideCardPlacement(
    "roadmap",
    view.kind !== "hidden" && (requested || popoverRequested),
  );
  const mode = placement?.mode ?? null;
  const cardOpen = mode === "inline" ? requested : popoverRequested && mode !== null;
  if (mode === "inline" && popoverRequested) setPopoverRequested(false);
  const closeCard = () => {
    if (mode === "popover") setPopoverRequested(false);
    else setOverride(false);
  };

  if (view.kind === "hidden") return null;
  const label =
    view.kind === "attached" ? `Roadmap: ${view.item.title}` : "Roadmap: not on the roadmap";
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="outline"
              data-toolbar-control=""
              aria-label={label}
              aria-expanded={cardOpen}
              onClick={() => {
                if (cardOpen) closeCard();
                else if (measureThreadSideCard("roadmap")?.mode === "popover")
                  setPopoverRequested(true);
                else setOverride(true);
              }}
            />
          }
        >
          <MapIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
      {cardOpen && placement ? (
        <RoadmapCard placement={placement} onClose={closeCard}>
          <RoadmapCardBody
            view={view}
            items={items ?? []}
            sprints={live.data?.sprints ?? EMPTY_SPRINTS}
            areaSettings={areaSettings}
            canChange={availability.canChange}
            pullRequestEnvironmentId={thread.environmentId}
            minimized={minimized}
            onMinimizedChange={setMinimized}
            onClose={closeCard}
            onOpenItem={actions.openInRoadmap}
            onAttach={() => openRoadmapAttachPicker(threadRef)}
            onCreate={(type) => void actions.createFromThread(thread, type, { newThread: false })}
            onUpdate={(itemId, patch) => void actions.updateItem(itemId, patch)}
            onTick={(itemId, criterionId, ticked) =>
              void actions.tickCriterion(itemId, criterionId, ticked)
            }
            onCommand={actions.runCommand}
          />
        </RoadmapCard>
      ) : null}
    </>
  );
}
