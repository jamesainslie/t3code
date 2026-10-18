/**
 * Fork: roadmap. The thread-side roadmap actions shared by the sidebar's
 * thread menu, the chat header's thread menu, the command palette and the
 * Roadmap card: create a work item from a thread, attach, detach.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  RoadmapItemId,
  isRoadmapError,
  type EnvironmentId,
  type ProjectId,
  type RoadmapCommand,
  type RoadmapItemPatch,
  type RoadmapItemType,
  type RoadmapThreadRef,
  type RoadmapWorkItem,
  type ThreadId,
} from "@lathe/contracts";
import { scopeProjectRef, scopeThreadRef } from "@lathe/client-runtime/environment";
import { attachedItemFor } from "@lathe/client-runtime/roadmap/tree";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@lathe/client-runtime/state/runtime";
import { useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useMemo, useRef } from "react";

import { openRoadmapAttachPicker } from "../../commandPaletteBus";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useStableCallback } from "../../hooks/useStableCallback";
import { randomUUID } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { roadmapEnvironment, useRoadmapHome } from "../../state/roadmap";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadActionMenuId, ThreadActionMenuRoadmapState } from "../threadActionMenu.logic";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ROADMAP_ITEM_TYPE_LABELS, ROADMAP_ITEM_TYPES, roadmapHref } from "./roadmapThread.logic";

/**
 * The thread menu's "Start a new thread for it" toggle. It lives for the
 * session: the menu closes on every click, so the choice has to outlast it.
 */
export const roadmapCreateInNewThreadAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("roadmap:create-in-new-thread"),
);

export interface RoadmapAvailability {
  readonly home: EnvironmentId | null;
  /** The home advertises a roadmap, as of its last known config. */
  readonly supported: boolean;
  readonly homeConnected: boolean;
  /** This client may dispatch roadmap commands to the home. */
  readonly canChange: boolean;
}

export function useRoadmapAvailability(): RoadmapAvailability {
  const home = useRoadmapHome();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const connected = useConnectedEnvironmentIds();
  const canChange = useAtomValue(roadmapEnvironment.dispatchRoadmap.permissionAtom(home));
  return {
    home,
    supported: home !== null && configs.get(home)?.environment.capabilities.roadmap === true,
    homeConnected: home !== null && connected.includes(home),
    canChange,
  };
}

/** The thread fields the roadmap actions need, as sidebar and route threads both carry them. */
export interface RoadmapThreadTarget {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
}

const threadRefOf = (thread: RoadmapThreadTarget): RoadmapThreadRef => ({
  environmentId: thread.environmentId,
  threadId: thread.id,
});

const newCommandId = () => CommandId.make(randomUUID());

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useRoadmapThreadActions() {
  const availability = useRoadmapAvailability();
  const { home, supported } = availability;
  const router = useRouter();
  const dispatch = useAtomCommand(roadmapEnvironment.dispatchRoadmap, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  // Menus read attachment when they open. Holding the latest items in a ref,
  // rather than rendering them, keeps roadmap edits from re-rendering hosts
  // as large as the sidebar.
  const itemsRef = useRef<ReadonlyArray<RoadmapWorkItem> | null>(null);
  useEffect(() => {
    itemsRef.current = null;
    if (home === null || !supported) return;
    return appAtomRegistry.subscribe(
      roadmapEnvironment.roadmapLive({ environmentId: home, input: {} }),
      (result) => {
        itemsRef.current = Option.getOrNull(AsyncResult.value(result))?.items ?? null;
      },
      { immediate: true },
    );
  }, [home, supported]);

  const send = async (
    command: RoadmapCommand,
  ): Promise<AtomCommandResult<unknown, unknown> | null> =>
    home === null ? null : dispatch({ environmentId: home, input: { command } });

  /** False after reporting the failure, so callers only handle success. */
  const succeeded = (
    result: AtomCommandResult<unknown, unknown> | null,
    title: string,
  ): result is AtomCommandResult<unknown, unknown> => {
    if (result === null) {
      failureToast(title, new Error("The roadmap home is not known yet."));
      return false;
    }
    if (result._tag === "Success") return true;
    if (!isAtomCommandInterrupted(result)) failureToast(title, squashAtomCommandFailure(result));
    return false;
  };

  const openInRoadmap = (itemId: RoadmapItemId) => {
    void router.navigate({ href: roadmapHref({ item: itemId }) });
  };

  const attachedItem = (thread: RoadmapThreadRef) =>
    itemsRef.current === null ? null : attachedItemFor(itemsRef.current, thread);

  const detachFrom = async (thread: RoadmapThreadRef, item: RoadmapWorkItem) => {
    const result = await send({
      type: "roadmap.thread.detach",
      commandId: newCommandId(),
      itemId: item.id,
      thread,
    });
    if (!succeeded(result, "Could not detach thread")) return false;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Detached from ${item.title}`,
        timeout: 5_000,
        actionProps: { children: "Undo", onClick: () => void attach(thread, item) },
      }),
    );
    return true;
  };

  const attach = async (thread: RoadmapThreadRef, item: RoadmapWorkItem): Promise<void> => {
    const result = await send({
      type: "roadmap.thread.attach",
      commandId: newCommandId(),
      itemId: item.id,
      thread,
    });
    if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      const current = attachedItem(thread);
      // Phase 1 keeps one work item per thread, so attaching elsewhere is a move.
      if (isRoadmapError(error) && error.code === "already_attached" && current !== null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: `This thread is on ${current.title}`,
            description: `Move it to ${item.title}?`,
            actionProps: {
              children: "Move here",
              onClick: () => {
                void (async () => {
                  if (await detachFrom(thread, current)) await attach(thread, item);
                })();
              },
            },
          }),
        );
        return;
      }
    }
    if (!succeeded(result, "Could not attach thread")) return;
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Attached to ${item.title}`,
        timeout: 5_000,
        actionProps: { children: "Undo", onClick: () => void detachFrom(thread, item) },
      }),
    );
  };

  const detach = async (thread: RoadmapThreadRef) => {
    const current = attachedItem(thread);
    if (current === null) {
      failureToast("Could not detach thread", new Error("This thread is not on the roadmap."));
      return;
    }
    await detachFrom(thread, current);
  };

  /**
   * Creates a work item titled after the thread, with the thread as its
   * origin. It attaches the thread, or with `newThread` a fresh thread in the
   * same project. A thread already on another item stays there.
   */
  const createFromThread = async (
    thread: RoadmapThreadTarget,
    itemType: RoadmapItemType,
    options: { readonly newThread: boolean },
  ) => {
    const ref = threadRefOf(thread);
    const current = attachedItem(ref);
    const attachHere = !options.newThread && current === null;
    const itemId = RoadmapItemId.make(randomUUID());
    const title = thread.title.trim() || "Untitled thread";
    const label = ROADMAP_ITEM_TYPE_LABELS[itemType];
    const created = await send({
      type: "roadmap.item.create",
      commandId: newCommandId(),
      itemId,
      itemType,
      title,
      origin: ref,
      ...(attachHere ? { attachThread: ref } : {}),
    });
    if (!succeeded(created, "Could not create work item")) return;
    const openAction = { children: "Open in Roadmap", onClick: () => openInRoadmap(itemId) };
    if (options.newThread) {
      const opened = await settlePromise(() =>
        handleNewThread(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (opened._tag === "Failure" || opened.value === null) {
        failureToast(
          `Created ${label}, but could not start a thread for it`,
          opened._tag === "Failure" ? squashAtomCommandFailure(opened) : null,
        );
        return;
      }
      // The draft has its thread id already; the attachment resolves once it is sent.
      const attached = await send({
        type: "roadmap.thread.attach",
        commandId: newCommandId(),
        itemId,
        thread: { environmentId: thread.environmentId, threadId: opened.value.threadId },
      });
      if (!succeeded(attached, `Created ${label}, but could not attach the new thread`)) return;
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Created ${label} for a new thread`,
          description: title,
          timeout: 5_000,
          actionProps: openAction,
        }),
      );
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `Created ${label}`,
        description: current === null ? title : `${title}. This thread stays on ${current.title}.`,
        timeout: 5_000,
        actionProps: openAction,
      }),
    );
  };

  /** An inline edit: the card's fields go through the same command the Outline uses. */
  const updateItem = async (itemId: RoadmapItemId, patch: RoadmapItemPatch) => {
    const result = await send({
      type: "roadmap.item.update",
      commandId: newCommandId(),
      itemId,
      patch,
    });
    succeeded(result, "Could not update work item");
  };

  const tickCriterion = async (itemId: RoadmapItemId, criterionId: string, ticked: boolean) => {
    const result = await send({
      type: "roadmap.criterion.tick",
      commandId: newCommandId(),
      itemId,
      criterionId,
      ticked,
    });
    succeeded(result, ticked ? "Could not tick criterion" : "Could not untick criterion");
  };

  const menuState = (thread: RoadmapThreadRef): ThreadActionMenuRoadmapState => ({
    attachedTitle: attachedItem(thread)?.title ?? null,
    createInNewThread: appAtomRegistry.get(roadmapCreateInNewThreadAtom),
    canChange: availability.canChange,
  });

  /**
   * Runs a roadmap entry from a thread menu. Null for any other entry;
   * "reopen" asks the menu to show again so a flipped toggle is visible.
   */
  const handleMenuAction = (
    action: ThreadActionMenuId,
    thread: RoadmapThreadTarget,
  ): "reopen" | "handled" | null => {
    if (!action.startsWith("roadmap-")) return null;
    if (action === "roadmap-create:new-thread") {
      appAtomRegistry.set(
        roadmapCreateInNewThreadAtom,
        !appAtomRegistry.get(roadmapCreateInNewThreadAtom),
      );
      return "reopen";
    }
    if (action === "roadmap-attach") {
      openRoadmapAttachPicker(scopeThreadRef(thread.environmentId, thread.id));
      return "handled";
    }
    if (action === "roadmap-detach") {
      void detach(threadRefOf(thread));
      return "handled";
    }
    const itemType = ROADMAP_ITEM_TYPES.find((type) => action === `roadmap-create:${type}`);
    if (itemType !== undefined) {
      void createFromThread(thread, itemType, {
        newThread: appAtomRegistry.get(roadmapCreateInNewThreadAtom),
      });
    }
    return "handled";
  };

  const stableAttach = useStableCallback(attach);
  const stableDetach = useStableCallback(detach);
  const stableCreateFromThread = useStableCallback(createFromThread);
  const stableUpdateItem = useStableCallback(updateItem);
  const stableTickCriterion = useStableCallback(tickCriterion);
  const stableMenuState = useStableCallback(menuState);
  const stableHandleMenuAction = useStableCallback(handleMenuAction);
  const stableOpenInRoadmap = useStableCallback(openInRoadmap);
  const actions = useMemo(
    () => ({
      attach: stableAttach,
      detach: stableDetach,
      createFromThread: stableCreateFromThread,
      updateItem: stableUpdateItem,
      tickCriterion: stableTickCriterion,
      menuState: stableMenuState,
      handleMenuAction: stableHandleMenuAction,
      openInRoadmap: stableOpenInRoadmap,
    }),
    [
      stableAttach,
      stableCreateFromThread,
      stableDetach,
      stableHandleMenuAction,
      stableMenuState,
      stableOpenInRoadmap,
      stableTickCriterion,
      stableUpdateItem,
    ],
  );
  return { availability, actions };
}
