/**
 * Fork: roadmap. The Today tab's reads and writes: when it was last opened,
 * the attached threads' signals, review requests, and the row actions.
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  RoadmapReviewRequests,
  RoadmapThreadSignals,
} from "@lathe/client-runtime/roadmap/today";
import type { EnvironmentThreadShell } from "@lathe/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@lathe/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IsoDate,
  RoadmapItemState,
  RoadmapThreadRef,
  RoadmapWorkItem,
} from "@lathe/contracts";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useStableCallback } from "../../hooks/useStableCallback";
import { usePullRequestList } from "../../state/pullRequests";
import { roadmapEnvironment } from "../../state/roadmap";
import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUiStateStore } from "../../uiStateStore";
import { toastManager } from "../ui/toast";
import {
  createTodayBaselines,
  parseTodayLastOpenedAt,
  roadmapPinFailure,
  roadmapReviewRequests,
  roadmapReviewTargets,
  roadmapThreadSignals,
  roadmapTodayThreadKey,
  roadmapTodayThreadOf,
  roadmapTodayThreadRefs,
  todayShortDate,
  todayLastOpenedStorageKey,
  type RoadmapTodayThread,
} from "./roadmapToday.logic";
import { newRoadmapCommandId, useRoadmapDispatch } from "./useRoadmapDispatch";
import { useRoadmapThreadActions } from "./useRoadmapThreadActions";

const todayBaselineFor = createTodayBaselines({
  read: (home) => {
    try {
      return parseTodayLastOpenedAt(localStorage.getItem(todayLastOpenedStorageKey(home)));
    } catch {
      return null;
    }
  },
  write: (home, at) => {
    try {
      localStorage.setItem(todayLastOpenedStorageKey(home), at);
    } catch {
      // Blocked or full storage only means every visit looks back one day.
    }
  },
});

/**
 * When Today was last opened on this client before this page load, so
 * "Newly unblocked" compares against the previous visit rather than this one.
 */
export function useRoadmapTodayLastOpenedAt(home: EnvironmentId, now: string): string | null {
  // Repeat calls for a home return the cached baseline, so a render React
  // discards or repeats records nothing new.
  return useMemo(() => todayBaselineFor(home, now), [home, now]);
}

// React cannot subscribe to a list of atoms whose length changes, so the
// attached threads fan out inside one atom keyed by their refs.
const attachedShellsAtom = Atom.family((key: string) =>
  Atom.make((get) =>
    (JSON.parse(key) as ReadonlyArray<RoadmapThreadRef>).map((ref) =>
      get(environmentThreadShells.threadShellAtom(ref)),
    ),
  ).pipe(Atom.withLabel(`roadmap-today-shells:${key}`)),
);
const NO_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell | null>>([]).pipe(
  Atom.withLabel("roadmap-today-shells:none"),
);
const NO_ENTRIES: ReadonlyArray<never> = [];

export interface RoadmapTodaySignals {
  readonly threadSignals: RoadmapThreadSignals;
  readonly reviewRequests: RoadmapReviewRequests;
}

/**
 * Signals from the shells the client already holds for every connected
 * environment, so attached threads anywhere count, plus one review-requested
 * pull request listing per environment whose attached threads link one.
 */
export function useRoadmapTodaySignals(items: ReadonlyArray<RoadmapWorkItem>): RoadmapTodaySignals {
  const refs = useMemo(() => roadmapTodayThreadRefs(items), [items]);
  const refsKey = JSON.stringify(refs);
  const shells = useAtomValue(refs.length === 0 ? NO_SHELLS_ATOM : attachedShellsAtom(refsKey));
  const localVisits = useUiStateStore((state) => state.threadLastVisitedAtById);
  const threads = useMemo(() => {
    const byKey = new Map<string, RoadmapTodayThread>();
    for (const shell of shells) {
      if (shell === null) continue;
      const thread = roadmapTodayThreadOf(
        shell,
        localVisits[
          roadmapTodayThreadKey({ environmentId: shell.environmentId, threadId: shell.id })
        ],
      );
      byKey.set(roadmapTodayThreadKey(thread.ref), thread);
    }
    return byKey;
  }, [localVisits, shells]);
  const targets = useMemo(() => roadmapReviewTargets(threads.values()), [threads]);
  const reviews = usePullRequestList(targets);
  const entries = reviews.data?.entries ?? NO_ENTRIES;
  return useMemo(
    () => ({
      threadSignals: roadmapThreadSignals(items, threads),
      reviewRequests: roadmapReviewRequests(items, threads, entries),
    }),
    [entries, items, threads],
  );
}

/** Stable across renders, so memoized rows only re-render for their own data. */
export interface RoadmapTodayActions {
  readonly snooze: (item: RoadmapWorkItem, until: IsoDate) => void;
  readonly unsnooze: (item: RoadmapWorkItem) => void;
  readonly done: (item: RoadmapWorkItem) => void;
  readonly togglePin: (item: RoadmapWorkItem) => void;
  readonly newThread: (item: RoadmapWorkItem) => void;
}

export function useRoadmapTodayActions(home: EnvironmentId): RoadmapTodayActions {
  const dispatch = useRoadmapDispatch(home);
  const dispatchRaw = useAtomCommand(roadmapEnvironment.dispatchRoadmap, {
    label: "roadmap pin",
    reportFailure: false,
  });
  const { actions: threadActions } = useRoadmapThreadActions();

  const unsnooze = (item: RoadmapWorkItem) =>
    void dispatch(
      { type: "roadmap.item.unsnooze", commandId: newRoadmapCommandId(), itemId: item.id },
      "Could not unsnooze",
    );

  const snooze = async (item: RoadmapWorkItem, until: IsoDate) => {
    const snoozed = await dispatch(
      { type: "roadmap.item.snooze", commandId: newRoadmapCommandId(), itemId: item.id, until },
      "Could not snooze",
    );
    if (!snoozed) return;
    const toastId = toastManager.add({
      type: "success",
      title: `Snoozed until ${todayShortDate(until)}`,
      description: item.title,
      timeout: 5_000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          unsnooze(item);
        },
      },
    });
  };

  const setState = (item: RoadmapWorkItem, state: RoadmapItemState, failureTitle: string) =>
    dispatch(
      {
        type: "roadmap.item.update",
        commandId: newRoadmapCommandId(),
        itemId: item.id,
        patch: { state },
      },
      failureTitle,
    );

  const done = async (item: RoadmapWorkItem) => {
    const previous = item.state;
    if (!(await setState(item, "done", "Could not mark done"))) return;
    const toastId = toastManager.add({
      type: "success",
      title: `Done: ${item.title}`,
      timeout: 5_000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toastId);
          void setState(item, previous, "Could not reopen");
        },
      },
    });
  };

  const togglePin = async (item: RoadmapWorkItem) => {
    if (item.pinnedAt !== null) {
      await dispatch(
        { type: "roadmap.item.unpin", commandId: newRoadmapCommandId(), itemId: item.id },
        "Could not unpin",
      );
      return;
    }
    // A full set of picks gets its own toast, so pinning reads the refusal itself.
    const result = await dispatchRaw({
      environmentId: home,
      input: {
        command: { type: "roadmap.item.pin", commandId: newRoadmapCommandId(), itemId: item.id },
      },
    });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    toastManager.add({ type: "error", ...roadmapPinFailure(squashAtomCommandFailure(result)) });
  };

  // The palette's own project picker starts the thread; attaching it after is
  // what the thread menu's "start a new thread" option does too.
  const newThread = (item: RoadmapWorkItem) =>
    openCommandPalette({
      open: "new-thread-in",
      onThreadCreated: (thread) => void threadActions.attach(thread, item),
    });

  const stableSnooze = useStableCallback(snooze);
  const stableUnsnooze = useStableCallback(unsnooze);
  const stableDone = useStableCallback(done);
  const stableTogglePin = useStableCallback(togglePin);
  const stableNewThread = useStableCallback(newThread);
  return useMemo(
    () => ({
      snooze: (item, until) => void stableSnooze(item, until),
      unsnooze: stableUnsnooze,
      done: (item) => void stableDone(item),
      togglePin: (item) => void stableTogglePin(item),
      newThread: stableNewThread,
    }),
    [stableDone, stableNewThread, stableSnooze, stableTogglePin, stableUnsnooze],
  );
}
