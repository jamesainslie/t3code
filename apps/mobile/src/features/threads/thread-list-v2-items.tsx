import * as Dialog from "../../components/ui/Dialog";
import type { ThreadRowProviderInstance } from "./thread-provider-instance";
import {
  THREAD_LIST_V2_MONO_FONT as MONO_FONT,
  THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME,
  THREAD_LIST_V2_ROW_DIVIDERS,
  selectedThreadRowColors,
  getThreadListV2NewBranchMenuTitle,
  getThreadListV2RowAppearance,
} from "./thread-list-v2-row-appearance";
import { RowPressable } from "../../components/ui/RowPressable";
import { CustomSnoozeSheet } from "./CustomSnoozeSheet";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadArrangementOpenAtom } from "../../state/thread-order";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useVisibleSecondClock } from "./use-visible-second-clock";
import type { ThreadMoveDestination } from "./threadOrder";
import type { EnvironmentProject, EnvironmentThreadShell } from "@lathe/client-runtime/state/shell";
import type { EnvironmentThreadSearchMatch } from "@lathe/client-runtime/state/thread-search";
import {
  formatWorkingDurationLabel,
  resolveThreadWorkingStartedAt,
} from "@lathe/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_THREAD_HIGHLIGHT_PALETTE,
  type EnvironmentMachineKind,
} from "@lathe/contracts";
import { buildThreadChipClipboard } from "@lathe/shared/threadContextReference";
import {
  canAddDependency,
  canSnooze,
  resolveSnoozePresets,
  resolveSnoozeReminder,
} from "@lathe/client-runtime/state/thread-settled";
import type { MenuAction } from "@react-native-menu/menu";
import { memo, useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

import type { ThreadListProvider } from "../../state/thread-list-environments";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { EnvironmentMachineSymbol } from "../../components/EnvironmentMachineSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { ProviderIcon, ProviderInstanceIcon } from "../../components/ProviderIcon";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic, playCopyHaptic } from "../../lib/copyTextWithHaptic";
import { writeComposerContextClipboard } from "../../lib/composerContextClipboard";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useEnvironmentScope } from "../../state/session";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  resolveThreadPrBadgeAction,
  type ThreadPrPresentation,
} from "../../state/thread-pr-presentation";
import { useThreadPr } from "../../state/use-thread-pr";
import { useSwipeRowDormant } from "../home/swipe-row-activation";
import { ThreadSwipeable } from "../home/thread-swipe-actions";
import {
  buildThreadHighlightMenuAction,
  resolveThreadHighlightMenuSelection,
} from "./thread-highlight-menu";
import { buildThreadTitleRegenerationMenuItems } from "./thread-title-regeneration-menu";
import {
  THREAD_LIST_V2_SETTLED_PAGE_COUNT,
  resolveThreadListV2SnoozeGateExpiryMs,
  resolveThreadListV2SnoozeMenuSelection,
  threadHasUnseenCompletion,
  resolveThreadListV2Status,
  resolveThreadListV2ProviderDrivers,
  resolveThreadListV2SwipeActions,
  type ThreadListV2Status,
} from "./threadListV2";
import { QueuedMessageIcon } from "./queued-message-icon";
import { shouldRecedeThreadRow } from "./thread-row-emphasis";
import { ThreadSearchMatchExcerpt } from "./thread-search-match";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { pullRequestStatus } from "../pull-requests/pullRequestStatus";

interface StatusLabel {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly className: string;
  readonly iconTintClassName: string;
}
const STATUS_LABEL_BY_STATUS: Partial<Record<ThreadListV2Status, StatusLabel>> = {
  approval: {
    label: "Approval",
    icon: "exclamationmark.shield",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
  input: {
    label: "Input",
    icon: "questionmark.bubble",
    className: "text-adaptive-indigo-600-300",
    iconTintClassName: "accent-adaptive-indigo-600-300",
  },
  working: {
    label: "Working",
    icon: "circle.dashed",
    className: "text-adaptive-sky-600-400",
    iconTintClassName: "accent-adaptive-sky-600-400",
  },
  waiting: {
    label: "Waiting",
    icon: "circle.dashed.inset.filled",
    className: "text-foreground-muted",
    iconTintClassName: "accent-foreground-muted",
  },
  failed: {
    label: "Failed",
    icon: "exclamationmark.circle",
    className: "text-danger-foreground",
    iconTintClassName: "accent-danger-foreground",
  },
  limited: {
    label: "Limited",
    icon: "exclamationmark.circle",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
};
const DONE_STATUS_LABEL: StatusLabel = {
  label: "Done",
  icon: "checkmark.circle",
  className: "text-adaptive-emerald-700-300",
  iconTintClassName: "accent-adaptive-emerald-700-300",
};

function ThreadListV2Duration(props: { readonly startedAt: string | null }) {
  const startedAtMs = Date.parse(props.startedAt ?? "");
  const nowMs = useVisibleSecondClock(Number.isFinite(startedAtMs));
  if (!Number.isFinite(startedAtMs)) return null;
  return ` ${formatWorkingDurationLabel(nowMs - startedAtMs)}`;
}

const CARD_MENU_ACTIONS: MenuAction[] = [
  { id: "settle", title: "Settle", image: "checkmark" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SLIM_MENU_ACTIONS: MenuAction[] = [
  { id: "unsettle", title: "Un-settle", image: "arrow.uturn.backward" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const SNOOZED_MENU_ACTIONS: MenuAction[] = [
  { id: "unsnooze", title: "Wake thread", image: "clock" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

// The Depends on shelf offers the one way out plus the usual tail. Release
// drops every link, so a blocked row needs no per-link surface.
const BLOCKED_MENU_ACTIONS: MenuAction[] = [
  { id: "release", title: "Wake thread", image: "link" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const LEGACY_MENU_ACTIONS: MenuAction[] = [
  { id: "archive", title: "Archive", image: "archivebox" },
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

function ThreadListV2Section(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
  /** "snoozed" is the parked treatment, shared by both parked shelves. */
  readonly tone?: "default" | "snoozed";
  readonly disclosure?: {
    readonly expanded: boolean;
    readonly disabled?: boolean;
    readonly onToggle: () => void;
    readonly accessibilityLabel: string;
    readonly accessibilityHint: string;
  };
}) {
  const snoozed = props.tone === "snoozed";
  const sidebarPane = props.pane === "sidebar";
  const className = cn(
    "mb-1.5 mt-4 flex-row items-center gap-2.5",
    props.pane === "sidebar" ? "px-3" : "px-5",
  );
  const content = (
    <>
      <Text
        className={cn(
          "text-xs font-t3-medium",
          sidebarPane
            ? "text-drawer-foreground-muted"
            : snoozed
              ? "text-foreground-secondary"
              : "text-foreground-tertiary",
        )}
      >
        {props.label}
      </Text>
      <View
        className={cn(
          "h-px flex-1",
          snoozed ? "bg-primary/20" : sidebarPane ? "bg-drawer-border" : "bg-border",
        )}
      />
      {props.disclosure ? (
        <SymbolView
          name="chevron.down"
          size={10}
          tintColorClassName={
            sidebarPane
              ? "accent-drawer-foreground-muted"
              : snoozed
                ? "accent-icon-muted"
                : "accent-foreground-muted"
          }
          type="monochrome"
          style={{ transform: [{ rotate: props.disclosure.expanded ? "180deg" : "0deg" }] }}
        />
      ) : null}
    </>
  );

  return props.disclosure ? (
    <Pressable
      accessibilityHint={props.disclosure.accessibilityHint}
      accessibilityLabel={props.disclosure.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        disabled: props.disclosure.disabled,
        expanded: props.disclosure.expanded,
      }}
      className={className}
      disabled={props.disclosure.disabled}
      onPress={props.disclosure.onToggle}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {content}
    </Pressable>
  ) : (
    <View className={className}>{content}</View>
  );
}

export const ThreadListV2SectionDivider = memo(function ThreadListV2SectionDivider(props: {
  readonly label: string;
  readonly pane?: "screen" | "sidebar";
}) {
  return <ThreadListV2Section {...props} />;
});

type ThreadListV2ShelfHeaderProps = {
  readonly count: number;
  readonly disabled?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly pane?: "screen" | "sidebar";
};

// Fork: the blocked shelf reads "Depends on" and speaks of "waiting" threads.
const SHELF_LABELS = {
  working: { label: "Working", noun: "working" },
  snoozed: { label: "Snoozed", noun: "snoozed" },
  settled: { label: "Settled", noun: "settled" },
  blocked: { label: "Depends on", noun: "waiting" },
} as const;

function ThreadListV2ShelfHeader(
  props: ThreadListV2ShelfHeaderProps & { readonly kind: keyof typeof SHELF_LABELS },
) {
  const { label, noun } = SHELF_LABELS[props.kind];
  return (
    <ThreadListV2Section
      label={props.expanded ? label : `${label} (${props.count})`}
      pane={props.pane}
      tone={props.kind === "snoozed" || props.kind === "blocked" ? "snoozed" : "default"}
      disclosure={{
        expanded: props.expanded,
        disabled: props.disabled,
        onToggle: props.onToggle,
        accessibilityLabel: `${props.count} ${noun} ${props.count === 1 ? "thread" : "threads"}`,
        accessibilityHint: `${props.expanded ? "Collapses" : "Expands"} the ${noun} threads.`,
      }}
    />
  );
}

export const ThreadListV2WorkingShelfHeader = memo(function ThreadListV2WorkingShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="working" />;
});

export const ThreadListV2SnoozedShelfHeader = memo(function ThreadListV2SnoozedShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="snoozed" />;
});

export const ThreadListV2SettledShelfHeader = memo(function ThreadListV2SettledShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="settled" />;
});

export const ThreadListV2BlockedShelfHeader = memo(function ThreadListV2BlockedShelfHeader(
  props: ThreadListV2ShelfHeaderProps,
) {
  return <ThreadListV2ShelfHeader {...props} kind="blocked" />;
});

export const ThreadListV2ShowMoreRow = memo(function ThreadListV2ShowMoreRow(props: {
  readonly pane?: "screen" | "sidebar";
  readonly hiddenCount: number;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${Math.min(props.hiddenCount, THREAD_LIST_V2_SETTLED_PAGE_COUNT)} more settled threads`}
      onPress={props.onPress}
      className="mx-4 mt-2 items-center rounded-lg border border-dashed border-border py-2.5"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Text
        className={
          props.pane === "sidebar"
            ? "text-xs font-t3-medium text-drawer-foreground-muted"
            : "text-xs font-t3-medium text-foreground-muted"
        }
      >
        Show more ({props.hiddenCount} settled hidden)
      </Text>
    </Pressable>
  );
});

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

const DRAFT_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Discard", image: "trash", attributes: { destructive: true } },
];

export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly selected?: boolean;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
  readonly showPendingDivider: boolean;
  readonly showTrailingDivider?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
  readonly fullSwipeWidth?: number;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly activationKey?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
}) {
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const { width: windowWidth } = useWindowDimensions();
  const dormant = useSwipeRowDormant(props.activationKey);
  const theme = useUniwindTheme();
  const sidebarPane = props.pane === "sidebar";
  const rowAppearance = getThreadListV2RowAppearance(theme, sidebarPane, props.selected ?? false);
  const isDraft = pendingTask.kind === "draft";
  const deleteLabel = isDraft ? "Discard" : "Delete";
  const handleDelete = useCallback(
    () => onDeletePendingTask(pendingTask),
    [onDeletePendingTask, pendingTask],
  );
  const deleteAction = useMemo(
    () => ({
      accessibilityLabel: `${deleteLabel} ${pendingTask.title}`,
      destructive: true,
      icon: "trash" as const,
      label: deleteLabel,
      onPress: handleDelete,
    }),
    [deleteLabel, handleDelete, pendingTask.title],
  );
  const projectTitle = props.projectTitle ?? props.project?.title ?? pendingTask.projectTitle ?? "";
  const branch = pendingTask.branch;

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") onDeletePendingTask(pendingTask);
    },
    [onDeletePendingTask, pendingTask],
  );

  const rowContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={pendingTask.environmentId}
            faviconPath={props.project.faviconPath}
            projectIcon={props.project.projectIcon}
            size={15}
            projectTitle={props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium text-foreground-muted",
            sidebarPane && "text-drawer-foreground-muted",
          )}
          numberOfLines={1}
        >
          {projectTitle}
        </Text>
        {isDraft ? (
          <View className="flex-row items-center gap-1">
            <SymbolView
              name="square.and.pencil"
              size={10}
              tintColorClassName="accent-adaptive-amber-700-300"
              type="monochrome"
            />
            <Text className="text-xs text-adaptive-amber-700-300">Draft</Text>
          </View>
        ) : (
          <Text
            className={cn(
              "text-xs text-foreground-tertiary",
              sidebarPane && "text-drawer-foreground-muted",
            )}
          >
            Sends on reconnect
          </Text>
        )}
      </View>
      <Text
        className={cn(
          "mt-1 text-base font-t3-medium text-foreground",
          sidebarPane && "text-drawer-foreground",
        )}
        numberOfLines={1}
      >
        {pendingTask.title}
      </Text>
      {branch || props.environmentLabel ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Text
            className={cn(
              "shrink text-xs text-foreground-muted",
              sidebarPane && "text-drawer-foreground-muted",
            )}
            numberOfLines={1}
          >
            {branch ? (
              <Text
                className={cn(
                  "text-xs text-foreground-muted",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
                style={{ fontFamily: MONO_FONT }}
              >
                {branch}
              </Text>
            ) : null}
            {branch && props.environmentLabel ? "  ·  " : null}
            {props.environmentLabel ? (
              <Text
                className={cn(
                  "text-xs text-foreground-tertiary",
                  sidebarPane && "text-drawer-foreground-muted",
                )}
              >
                {props.environmentLabel}
              </Text>
            ) : null}
          </Text>
          {props.environmentLabel && props.environmentMachine ? (
            <EnvironmentMachineSymbol
              kind={props.environmentMachine}
              size={11}
              tintColorClassName={
                sidebarPane ? "accent-drawer-foreground-muted" : "accent-foreground-tertiary"
              }
            />
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <>
      {props.showPendingDivider ? (
        <ThreadListV2SectionDivider label="Unsent" pane={props.pane} />
      ) : null}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={pendingTask.key}
        backgroundColor={rowAppearance.swipeBackgroundColor}
        containerStyle={rowAppearance.swipeContainerStyle}
        enableTrackpadSwipe
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={deleteAction}
        secondaryAction={null}
        resetKey={pendingTask.key}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={pendingTask.title}
      >
        {() => (
          <Menu
            actions={isDraft ? DRAFT_TASK_MENU_ACTIONS : PENDING_TASK_MENU_ACTIONS}
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            <RowPressable
              accessibilityHint={
                isDraft
                  ? `Opens the draft in the new task composer. Swipe left to ${deleteLabel.toLowerCase()}.`
                  : `Sends when the environment reconnects. Opens the task for editing. Swipe left to ${deleteLabel.toLowerCase()}.`
              }
              accessibilityLabel={pendingTask.title}
              accessibilityRole="button"
              accessibilityState={{ selected: props.selected ?? false }}
              key={pendingTask.key}
              className={rowAppearance.className}
              interactionClassName={rowAppearance.interactionClassName}
              interactionOpacity={rowAppearance.interactionOpacity}
              onPress={() => onSelectPendingTask(pendingTask)}
              style={rowAppearance.cardStyle}
            >
              {sidebarPane ? (
                rowContent
              ) : (
                <View>
                  <View className="px-5 py-2.5">{rowContent}</View>
                  {props.showTrailingDivider !== false ? (
                    <View className="ml-5 h-px bg-border-subtle" />
                  ) : null}
                </View>
              )}
            </RowPressable>
          </Menu>
        )}
      </ThreadSwipeable>
    </>
  );
});

export const ThreadListV2Row = memo(function ThreadListV2Row(props: {
  readonly thread: EnvironmentThreadShell;
  readonly variant: "card" | "slim";
  readonly hasQueuedMessages?: boolean;
  readonly snoozed?: boolean;
  /** Depends on shelf row: shows what it waits on and offers Wake. */
  readonly blocked?: boolean;
  /** "Waiting on {title}", resolved by the list against the full shell set. */
  readonly waitLabel?: string | null;
  readonly pinned?: boolean;
  readonly wokeAt: string | null;
  readonly snoozeWakeLabelText?: string;
  readonly timeLabel: string;
  readonly snoozePresetMinute: string;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly providers: ReadonlyArray<ThreadListProvider> | undefined;
  readonly providerInstance: ThreadRowProviderInstance | null;
  readonly environmentLabel: string | null;
  readonly environmentMachine?: EnvironmentMachineKind;
  readonly pane?: "screen" | "sidebar";
  readonly showTrailingDivider?: boolean;
  readonly selected?: boolean;
  readonly fullSwipeWidth?: number;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenThreadPullRequests: (
    thread: EnvironmentThreadShell,
    pr: ThreadPrPresentation,
  ) => void;
  readonly onDeleteThread: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadOnBranch: (thread: EnvironmentThreadShell) => void;
  /** Opens a new-thread draft on this thread's branch that references it. */
  readonly onContinueInNewThread: (thread: EnvironmentThreadShell) => void;
  /** The project lets agents read thread history, so a new thread can pick
      this one up by reference. */
  readonly continueSupported: boolean;
  readonly onRenameThread: (thread: EnvironmentThreadShell) => void;
  readonly onRegenerateThreadTitle: (thread: EnvironmentThreadShell) => void;
  readonly onSettleThread: (thread: EnvironmentThreadShell) => Promise<boolean>;
  /** `reminder` absent keeps any existing note; an empty string clears it. */
  readonly onSnoozeThread: (
    thread: EnvironmentThreadShell,
    snoozedUntil: string,
    reminder?: string,
  ) => void;
  readonly onUnsnoozeThread: (thread: EnvironmentThreadShell) => void;
  /** Opens the dependency picker for this thread. */
  readonly onAddThreadDependency: (thread: EnvironmentThreadShell) => void;
  /** Starts a new thread in the same place, linked back to this one. */
  readonly onNewThreadToUnblock: (thread: EnvironmentThreadShell) => void;
  /** Drops every link so the thread returns to the active list. */
  readonly onReleaseThreadDependencies: (thread: EnvironmentThreadShell) => void;
  readonly onUnsettleThread: (thread: EnvironmentThreadShell) => void;
  readonly onArchiveThread: (thread: EnvironmentThreadShell) => void;
  readonly onPinThread: (thread: EnvironmentThreadShell) => void;
  readonly onUnpinThread: (thread: EnvironmentThreadShell) => void;
  /** Sets the thread's highlight color; null clears it. */
  readonly onHighlightThread: (
    thread: EnvironmentThreadShell,
    color: string | null,
  ) => void | Promise<unknown>;
  readonly onSetThreadAutoSettle: (thread: EnvironmentThreadShell, enabled: boolean) => void;
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
  /** False on servers that predate snooze reminders. */
  readonly snoozeReminderSupported: boolean;
  /** False on servers that predate thread dependencies. */
  readonly dependenciesSupported: boolean;
  readonly pinningSupported: boolean;
  /** False on servers that predate thread highlights. */
  readonly highlightSupported: boolean;
  readonly autoSettleOptOutSupported: boolean;
  readonly titleRegenerationSupported: boolean;
  readonly reorderSupported?: boolean;
  readonly onMoveThread?: (
    thread: EnvironmentThreadShell,
    direction: ThreadMoveDestination,
  ) => void;
  readonly canMoveUp?: boolean;
  readonly canMoveDown?: boolean;
  readonly onSwipeableWillOpen: (methods: SwipeableMethods) => void;
  readonly onSwipeableClose: (methods: SwipeableMethods) => void;
  readonly activationKey?: string;
  readonly searchMatch?: EnvironmentThreadSearchMatch;
  readonly searchQuery?: string;
  readonly simultaneousSwipeGesture?: ComponentProps<typeof ThreadSwipeable>["simultaneousWith"];
}) {
  const { width: windowWidth } = useWindowDimensions();
  const {
    thread,
    variant,
    onSelectThread,
    onOpenThreadPullRequests,
    onDeleteThread,
    onRenameThread,
    onRegenerateThreadTitle,
    onNewThreadOnBranch,
    onContinueInNewThread,
    onSettleThread,
    onSnoozeThread,
    onUnsnoozeThread,
    onAddThreadDependency,
    onNewThreadToUnblock,
    onReleaseThreadDependencies,
    onUnsettleThread,
    onArchiveThread,
    onPinThread,
    onUnpinThread,
    onHighlightThread,
    onSetThreadAutoSettle,
    onMoveThread,
  } = props;
  const snoozedRow = props.snoozed === true;
  const blockedRow = props.blocked === true;
  const pinnedRow = props.pinned === true;
  const dormant = useSwipeRowDormant(props.activationKey);

  const selectThread = () => onSelectThread(thread);
  const { providerDrivers, providerIconUrl } = useMemo(() => {
    const provider = props.providers?.find(
      (candidate) =>
        candidate.instanceId ===
        (thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId),
    );
    return {
      providerDrivers: resolveThreadListV2ProviderDrivers(thread, props.providers),
      providerIconUrl: provider?.iconUrl,
    };
  }, [thread, props.providers]);

  const providerInstance = props.providerInstance;
  const pr = useThreadPr(thread);
  const prBadgeLabel = pr ? resolveThreadPrBadgeAction(pr).accessibilityLabel : null;
  const handleOpenPullRequests = useCallback(() => {
    if (pr) onOpenThreadPullRequests(thread, pr);
  }, [onOpenThreadPullRequests, pr, thread]);

  const theme = useUniwindTheme();
  const sidebarPane = props.pane === "sidebar";
  const selected = props.selected === true;
  const rowAppearance = getThreadListV2RowAppearance(theme, sidebarPane, selected);
  // Selection wins over a highlight, and a highlight replaces the pane's
  // resting surface; the provider badge's border blends into whichever shows.
  const highlightColor =
    !selected &&
    typeof thread.highlightColor === "string" &&
    thread.highlightColor.trim().length > 0
      ? thread.highlightColor
      : null;
  const rowStyle =
    highlightColor === null
      ? rowAppearance.style
      : { ...rowAppearance.style, backgroundColor: highlightColor };
  const rowCardStyle =
    highlightColor === null
      ? rowAppearance.cardStyle
      : { ...rowAppearance.cardStyle, backgroundColor: highlightColor };
  const providerIconSurfaceColor = highlightColor ?? rowAppearance.providerIconSurfaceColor;

  const status = resolveThreadListV2Status(thread);
  const isUnread = status === "ready" && threadHasUnseenCompletion(thread);
  const workingLabel = STATUS_LABEL_BY_STATUS[status];
  const showsWoke = status === "ready" && props.wokeAt !== null;
  const statusLabel =
    (status === "working" && workingLabel !== undefined && thread.goal?.status === "active"
      ? { ...workingLabel, label: "Goal" }
      : workingLabel) ?? (isUnread ? DONE_STATUS_LABEL : undefined);
  const recede = shouldRecedeThreadRow({ status, selected });
  const timeLabel = props.timeLabel;

  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const handleAcknowledgeWoke = useCallback(() => {
    if (props.wokeAt === null) return;
    void visitThread({
      environmentId: thread.environmentId,
      input: { threadId: thread.id, visitedAt: props.wokeAt },
    });
  }, [props.wokeAt, thread.environmentId, thread.id, visitThread]);
  // VoiceOver cannot focus buttons inside the accessible row.
  const rowAccessibilityActions = useMemo(
    () => [
      ...(prBadgeLabel ? [{ name: "openPullRequests", label: prBadgeLabel }] : []),
      ...(showsWoke ? [{ name: "dismissWoke", label: "Dismiss Woke notification" }] : []),
    ],
    [prBadgeLabel, showsWoke],
  );

  const handleDelete = useCallback(() => onDeleteThread(thread), [onDeleteThread, thread]);
  const handleRename = useCallback(() => onRenameThread(thread), [onRenameThread, thread]);
  const canOperateThread = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateThreadTitle(thread),
    [onRegenerateThreadTitle, thread],
  );
  const handleSettle = useCallback(() => onSettleThread(thread), [onSettleThread, thread]);
  // "reminder" opens the sheet with the note field focused.
  const [customSnooze, setCustomSnooze] = useState<"custom" | "reminder" | null>(null);
  // A recycled cell reassigns this mounted row to a different thread without
  // remounting it, and the render closure stops running while list equality
  // says the item is unchanged — so any row-local UI state must be dismissed
  // when the identity under it changes.
  const rowIdentity = `${thread.environmentId}:${thread.id}`;
  const [boundIdentity, setBoundIdentity] = useState(rowIdentity);
  if (boundIdentity !== rowIdentity) {
    setBoundIdentity(rowIdentity);
    setCustomSnooze(null);
  }
  const handleSnooze = useCallback(
    (snoozedUntil: string, reminder?: string) => onSnoozeThread(thread, snoozedUntil, reminder),
    [onSnoozeThread, thread],
  );
  const handleUnsnooze = useCallback(() => onUnsnoozeThread(thread), [onUnsnoozeThread, thread]);
  const handleDependsOn = useCallback(
    () => onAddThreadDependency(thread),
    [onAddThreadDependency, thread],
  );
  const handleNewThreadToUnblock = useCallback(
    () => onNewThreadToUnblock(thread),
    [onNewThreadToUnblock, thread],
  );
  const handleRelease = useCallback(
    () => onReleaseThreadDependencies(thread),
    [onReleaseThreadDependencies, thread],
  );
  const handleUnsettle = useCallback(() => onUnsettleThread(thread), [onUnsettleThread, thread]);
  const handlePin = useCallback(() => onPinThread(thread), [onPinThread, thread]);
  const handleUnpin = useCallback(() => onUnpinThread(thread), [onUnpinThread, thread]);
  const handleSetAutoSettle = useCallback(
    (enabled: boolean) => onSetThreadAutoSettle(thread, enabled),
    [onSetThreadAutoSettle, thread],
  );
  const handleMoveUp = useCallback(() => onMoveThread?.(thread, "up"), [onMoveThread, thread]);
  const handleMoveDown = useCallback(() => onMoveThread?.(thread, "down"), [onMoveThread, thread]);
  const handleArchive = useCallback(() => onArchiveThread(thread), [onArchiveThread, thread]);

  const canUnsettle = variant === "slim";
  // The React Compiler caches render results on props and state, so a clock read
  // in render would stay frozen until `thread` changes: the gate could never
  // expire and its timer would re-fire every 50ms. The gate's clock is state.
  const [snoozeGateClock, setSnoozeGateClock] = useState(() => ({ thread, now: Date.now() }));
  if (snoozeGateClock.thread !== thread) setSnoozeGateClock({ thread, now: Date.now() });
  const snoozeGateNow = new Date(snoozeGateClock.now).toISOString();
  const snoozeGateExpiryMs = props.snoozeSupported
    ? resolveThreadListV2SnoozeGateExpiryMs(thread, { now: snoozeGateNow })
    : null;
  useEffect(() => {
    // A gate still closed past its expiry is held by runtime status, not time,
    // so no clock tick can open it.
    if (snoozeGateExpiryMs === null || snoozeGateExpiryMs <= snoozeGateClock.now) return;
    const delayMs = Math.min(snoozeGateExpiryMs - Date.now() + 50, 2_147_483_647);
    const id = setTimeout(() => setSnoozeGateClock({ thread, now: Date.now() }), delayMs);
    return () => clearTimeout(id);
  }, [snoozeGateExpiryMs, snoozeGateClock.now, thread]);
  const swipeActions = resolveThreadListV2SwipeActions({
    variant,
    settlementSupported: props.settlementSupported,
    snoozeSupported: props.snoozeSupported,
    snoozable: canSnooze(thread, { now: snoozeGateNow }),
    snoozed: snoozedRow,
    blocked: blockedRow,
  });
  const snoozePresets = useMemo(
    () => (swipeActions.secondary === "snooze" ? resolveSnoozePresets(new Date()) : ([] as const)),
    [props.snoozePresetMinute, swipeActions.secondary],
  );
  const snoozePresetActions = useMemo<MenuAction[]>(
    () => [
      ...snoozePresets.map((preset) => ({
        id: `snooze:${preset.id}`,
        title: preset.label,
        subtitle: preset.whenLabel,
      })),
      { id: "snooze:custom", title: "Custom…" },
      ...(props.snoozeReminderSupported
        ? [{ id: "snooze:reminder", title: "Snooze with reminder…" }]
        : []),
    ],
    [props.snoozeReminderSupported, snoozePresets],
  );
  const arrangementMenuItems = useMemo<MenuAction[]>(
    () => [
      ...(props.reorderSupported === true
        ? [
            { id: "arrange", title: "Arrange threads…", image: "line.3.horizontal" },
            {
              id: "move-up",
              title: "Move up",
              image: "arrow.up",
              attributes: { disabled: props.canMoveUp !== true },
            } satisfies MenuAction,
            {
              id: "move-down",
              title: "Move down",
              image: "arrow.down",
              attributes: { disabled: props.canMoveDown !== true },
            } satisfies MenuAction,
          ]
        : []),
      ...(props.pinningSupported
        ? [
            thread.pinnedAt != null
              ? { id: "unpin", title: "Unpin", image: "pin.slash" }
              : { id: "pin", title: "Pin", image: "pin" },
          ]
        : []),
    ],
    [
      props.canMoveDown,
      props.canMoveUp,
      props.reorderSupported,
      props.pinningSupported,
      thread.pinnedAt,
      variant,
    ],
  );
  // Highlight is offered in every row state (card, slim, snoozed, blocked,
  // legacy) so a color can be set or cleared wherever the thread sits.
  const highlightMenuItems = useMemo<MenuAction[]>(
    () =>
      props.highlightSupported
        ? [
            buildThreadHighlightMenuAction({
              palette: DEFAULT_THREAD_HIGHLIGHT_PALETTE,
              currentColor: thread.highlightColor ?? null,
            }),
          ]
        : [],
    [props.highlightSupported, thread.highlightColor],
  );
  const autoSettleMenuItems = useMemo<MenuAction[]>(
    () =>
      props.autoSettleOptOutSupported
        ? [
            {
              id: "auto-settle",
              title: "Auto-settle behavior",
              image: "timer",
              subactions: [
                {
                  id: "auto-settle:enabled",
                  title: "Enabled",
                  state: thread.autoSettleDisabledAt == null ? "on" : "off",
                },
                {
                  id: "auto-settle:disabled",
                  title: "Disabled",
                  state: thread.autoSettleDisabledAt == null ? "off" : "on",
                },
              ],
            } satisfies MenuAction,
          ]
        : [],
    [props.autoSettleOptOutSupported, thread.autoSettleDisabledAt],
  );
  const titleMenuItems = useMemo<MenuAction[]>(
    () => [
      { id: "rename", title: "Rename", image: "square.and.pencil" },
      ...buildThreadTitleRegenerationMenuItems({
        supported: props.titleRegenerationSupported,
        isRegenerating: thread.titleRegeneration != null,
      }),
    ],
    [props.titleRegenerationSupported, thread.titleRegeneration],
  );
  // Both entry points sit beside Snooze: parking on a thread and parking on
  // a time are the same kind of decision. Disabled rather than hidden so the
  // feature stays discoverable on a thread that is momentarily ineligible.
  const dependencyMenuItems = useMemo<MenuAction[]>(() => {
    if (!props.dependenciesSupported) return [];
    const disabled = !canAddDependency(thread, { now: snoozeGateNow });
    return [
      {
        id: "depends-on",
        title: "Depends on…",
        image: "point.3.connected.trianglepath.dotted",
        attributes: { disabled },
      },
      {
        id: "new-thread-to-unblock",
        title: "Start a thread to unblock this",
        image: "square.and.pencil",
        attributes: { disabled },
      },
    ];
  }, [props.dependenciesSupported, snoozeGateNow, thread]);
  const snoozableCardMenuActions = useMemo<MenuAction[]>(
    () => [
      { id: "settle", title: "Settle", image: "checkmark" },
      {
        id: "snooze",
        title: "Snooze",
        image: "clock",
        subactions: snoozePresetActions,
      },
      ...dependencyMenuItems,
      ...arrangementMenuItems,
      ...highlightMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
    ],
    [
      arrangementMenuItems,
      autoSettleMenuItems,
      dependencyMenuItems,
      highlightMenuItems,
      snoozePresetActions,
      titleMenuItems,
    ],
  );
  const cardMenuActions = useMemo<MenuAction[]>(
    () => [
      CARD_MENU_ACTIONS[0]!,
      ...dependencyMenuItems,
      ...arrangementMenuItems,
      ...highlightMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      ...CARD_MENU_ACTIONS.slice(1),
    ],
    [
      arrangementMenuItems,
      autoSettleMenuItems,
      dependencyMenuItems,
      highlightMenuItems,
      titleMenuItems,
    ],
  );
  const slimMenuActions = useMemo<MenuAction[]>(
    () => [
      SLIM_MENU_ACTIONS[0]!,
      ...arrangementMenuItems.filter(
        (action) => action.id !== "move-up" && action.id !== "move-down",
      ),
      ...highlightMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      SLIM_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, autoSettleMenuItems, highlightMenuItems, titleMenuItems],
  );
  // Re-snoozing from the shelf is how a pending note is read, edited, or removed.
  const snoozedMenuActions = useMemo<MenuAction[]>(
    () => [
      SNOOZED_MENU_ACTIONS[0]!,
      ...(props.snoozeReminderSupported
        ? [{ id: "snooze:reminder", title: "Snooze with reminder…", image: "text.bubble" }]
        : []),
      ...highlightMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      LEGACY_MENU_ACTIONS[0]!,
      SNOOZED_MENU_ACTIONS[1]!,
    ],
    [autoSettleMenuItems, highlightMenuItems, props.snoozeReminderSupported, titleMenuItems],
  );
  const blockedMenuActions = useMemo<MenuAction[]>(
    () => [
      BLOCKED_MENU_ACTIONS[0]!,
      ...highlightMenuItems,
      ...titleMenuItems,
      ...autoSettleMenuItems,
      BLOCKED_MENU_ACTIONS[1]!,
    ],
    [autoSettleMenuItems, highlightMenuItems, titleMenuItems],
  );
  const legacyMenuActions = useMemo<MenuAction[]>(
    () => [
      LEGACY_MENU_ACTIONS[0]!,
      ...arrangementMenuItems,
      ...highlightMenuItems,
      ...titleMenuItems,
      LEGACY_MENU_ACTIONS[1]!,
    ],
    [arrangementMenuItems, highlightMenuItems, titleMenuItems],
  );
  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "new-thread-on-branch") onNewThreadOnBranch(thread);
      if (nativeEvent.event === "continue-in-new-thread") onContinueInNewThread(thread);
      if (nativeEvent.event === "settle") handleSettle();
      if (nativeEvent.event === "unsettle") handleUnsettle();
      if (nativeEvent.event === "unsnooze") handleUnsnooze();
      if (nativeEvent.event === "depends-on") handleDependsOn();
      if (nativeEvent.event === "new-thread-to-unblock") handleNewThreadToUnblock();
      if (nativeEvent.event === "release") handleRelease();
      if (nativeEvent.event === "pin") handlePin();
      if (nativeEvent.event === "unpin") handleUnpin();
      if (nativeEvent.event === "auto-settle:enabled") handleSetAutoSettle(true);
      if (nativeEvent.event === "auto-settle:disabled") handleSetAutoSettle(false);
      if (nativeEvent.event === "arrange") appAtomRegistry.set(threadArrangementOpenAtom, true);
      if (nativeEvent.event === "move-up") handleMoveUp();
      if (nativeEvent.event === "move-down") handleMoveDown();
      if (nativeEvent.event === "archive") handleArchive();
      if (nativeEvent.event === "rename") handleRename();
      if (nativeEvent.event === "regenerate-title") handleRegenerateTitle();
      if (nativeEvent.event === "copy-thread-id") {
        copyTextWithHaptic(thread.id, { target: "thread-id" });
      }
      if (nativeEvent.event === "copy-thread-chip") {
        const showCopyFailed = () => Dialog.alert("Could not copy", "Try again.");
        try {
          const chip = buildThreadChipClipboard({ thread });
          writeComposerContextClipboard(chip.text, chip.fragment).then(
            () => playCopyHaptic({ target: "thread-chip" }),
            showCopyFailed,
          );
        } catch (error) {
          console.error(error);
          showCopyFailed();
        }
      }
      if (nativeEvent.event === "delete") handleDelete();
      if (nativeEvent.event.startsWith("highlight:")) {
        const highlightSelection = resolveThreadHighlightMenuSelection(
          nativeEvent.event,
          DEFAULT_THREAD_HIGHLIGHT_PALETTE,
        );
        if (highlightSelection !== null) void onHighlightThread(thread, highlightSelection.color);
        return;
      }
      if (nativeEvent.event === "snooze:custom") {
        setCustomSnooze("custom");
        return;
      }
      if (nativeEvent.event === "snooze:reminder") {
        setCustomSnooze("reminder");
        return;
      }
      const snoozeSelection = resolveThreadListV2SnoozeMenuSelection({
        event: nativeEvent.event,
        displayedPresets: snoozePresets,
        now: new Date(),
      });
      if (snoozeSelection._tag === "selected") {
        handleSnooze(snoozeSelection.preset.snoozedUntil);
      } else if (snoozeSelection._tag === "expired") {
        Dialog.alert(
          "Could not snooze thread",
          "That snooze time has passed. Choose another time.",
        );
      }
    },
    [
      onContinueInNewThread,
      onHighlightThread,
      onNewThreadOnBranch,
      thread,
      handleArchive,
      handleDelete,
      handleDependsOn,
      handleNewThreadToUnblock,
      handleRelease,
      handleRegenerateTitle,
      handleRename,
      handleMoveDown,
      handleMoveUp,
      handlePin,
      handleSettle,
      handleSnooze,
      handleSetAutoSettle,
      handleUnpin,
      handleUnsettle,
      handleUnsnooze,
      setCustomSnooze,
      snoozePresets,
    ],
  );
  const primaryAction = useMemo(() => {
    if (swipeActions.primary === "archive") {
      return {
        accessibilityLabel: `Archive ${thread.title}`,
        icon: "archivebox" as const,
        label: "Archive",
        onPress: handleArchive,
      };
    }
    if (swipeActions.primary === "unsnooze") {
      return {
        accessibilityLabel: `Wake ${thread.title} now`,
        icon: "clock" as const,
        label: "Wake",
        onPress: handleUnsnooze,
      };
    }
    if (swipeActions.primary === "release") {
      return {
        accessibilityLabel: `Wake ${thread.title} now`,
        icon: "link" as const,
        label: "Wake",
        onPress: handleRelease,
      };
    }
    return swipeActions.primary === "unsettle"
      ? {
          accessibilityLabel: `Un-settle ${thread.title}`,
          icon: "arrow.uturn.backward" as const,
          label: "Un-settle",
          onPress: handleUnsettle,
        }
      : {
          accessibilityLabel: `Settle ${thread.title}`,
          icon: "checkmark" as const,
          label: "Settle",
          onPress: handleSettle,
        };
  }, [
    handleArchive,
    handleRelease,
    handleSettle,
    handleUnsettle,
    handleUnsnooze,
    swipeActions.primary,
    thread.title,
  ]);
  const secondaryAction = useMemo(
    () =>
      swipeActions.secondary === "snooze"
        ? {
            accessibilityLabel: `Choose when to snooze ${thread.title}`,
            icon: "clock" as const,
            label: "Snooze",
            menu: {
              actions: snoozePresetActions,
              onPressAction: handleMenuAction,
              title: "Snooze until",
            },
            onPress: () => undefined,
          }
        : null,
    [handleMenuAction, snoozePresetActions, swipeActions.secondary, thread.title],
  );
  const swipeAccessibilityHint = !canOperateThread
    ? "Opens the thread"
    : secondaryAction === null
      ? `Opens the thread. Swipe left to ${primaryAction.label.toLowerCase()}.`
      : `Opens the thread. Swipe left for ${primaryAction.label.toLowerCase()} and snooze actions.`;

  const cardContent = (
    <>
      <View className="flex-row items-center gap-1.5">
        {props.project ? (
          <ProjectFavicon
            environmentId={thread.environmentId}
            faviconPath={props.project.faviconPath}
            projectIcon={props.project.projectIcon}
            size={15}
            projectTitle={props.project.title}
            workspaceRoot={props.project.workspaceRoot}
          />
        ) : null}
        <Text
          className={cn(
            "flex-1 text-sm font-t3-medium",
            selected
              ? selectedThreadRowColors.mutedForegroundClassName
              : rowAppearance.mutedForegroundClassName,
          )}
          numberOfLines={1}
        >
          {props.projectTitle ?? props.project?.title ?? ""}
        </Text>
        {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
        {pinnedRow ? (
          <SymbolView
            name="pin"
            size={11}
            tintColorClassName={rowAppearance.mutedIconTintClassName}
            type="monochrome"
          />
        ) : null}
        {showsWoke ? (
          <Pressable
            className="-m-2.5 flex-row items-center gap-1 p-2.5"
            accessibilityRole="button"
            accessibilityLabel="Dismiss Woke notification"
            onPress={handleAcknowledgeWoke}
            onLongPress={() => undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <SymbolView
              name="bell.badge"
              size={13}
              tintColorClassName={
                selected ? selectedThreadRowColors.iconTintClassName : "accent-warning-foreground"
              }
              type="monochrome"
              weight="semibold"
            />
            <Text
              className={cn(
                "text-xs font-t3-bold",
                selected ? selectedThreadRowColors.foregroundClassName : "text-warning-foreground",
              )}
            >
              Woke
            </Text>
          </Pressable>
        ) : statusLabel ? (
          <View className="flex-row items-center gap-1">
            <SymbolView
              name={statusLabel.icon}
              size={13}
              tintColorClassName={
                selected ? selectedThreadRowColors.iconTintClassName : statusLabel.iconTintClassName
              }
              type="monochrome"
              weight="semibold"
            />
            <Text
              className={cn(
                "text-xs font-t3-bold",
                (status === "working" || status === "waiting") && "tabular-nums",
                selected ? selectedThreadRowColors.foregroundClassName : statusLabel.className,
              )}
            >
              {statusLabel.label}
              {status === "working" ? (
                <ThreadListV2Duration startedAt={resolveThreadWorkingStartedAt(thread)} />
              ) : status === "waiting" ? (
                <ThreadListV2Duration startedAt={thread.latestRun?.completedAt ?? null} />
              ) : null}
            </Text>
          </View>
        ) : (
          <Text
            className={cn(
              "text-xs tabular-nums",
              selected
                ? selectedThreadRowColors.foregroundClassName
                : rowAppearance.tertiaryForegroundClassName,
            )}
          >
            {timeLabel}
          </Text>
        )}
      </View>
      <Text
        className={cn(
          "mt-1 text-base",
          !recede && "font-t3-medium",
          selected
            ? selectedThreadRowColors.foregroundClassName
            : rowAppearance.foregroundClassName,
        )}
        numberOfLines={2}
      >
        {thread.title}
      </Text>
      {props.searchMatch ? (
        <View className="mt-1">
          <ThreadSearchMatchExcerpt
            sidebar={sidebarPane}
            match={props.searchMatch}
            query={props.searchQuery ?? ""}
            selected={selected}
          />
        </View>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2">
        {(status === "failed" || status === "limited") && thread.runtime?.lastError ? (
          <Text
            className={cn(
              "flex-1 text-xs",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : status === "limited"
                  ? "text-warning-foreground"
                  : "text-danger-foreground",
            )}
            numberOfLines={1}
          >
            {thread.runtime.lastError}
          </Text>
        ) : thread.branch || props.environmentLabel ? (
          <View className="min-w-0 flex-1 flex-row items-center gap-1">
            <Text
              className={cn(
                "shrink text-xs",
                selected
                  ? selectedThreadRowColors.mutedForegroundClassName
                  : rowAppearance.mutedForegroundClassName,
              )}
              numberOfLines={1}
            >
              {thread.branch ? (
                <Text
                  className={cn(
                    "text-xs",
                    selected
                      ? selectedThreadRowColors.mutedForegroundClassName
                      : rowAppearance.mutedForegroundClassName,
                  )}
                  style={{ fontFamily: MONO_FONT }}
                >
                  {thread.branch}
                </Text>
              ) : null}
              {thread.branch && props.environmentLabel ? "  ·  " : null}
              {props.environmentLabel ? (
                <Text
                  className={cn(
                    "text-xs",
                    selected
                      ? selectedThreadRowColors.mutedForegroundClassName
                      : rowAppearance.tertiaryForegroundClassName,
                  )}
                >
                  {props.environmentLabel}
                </Text>
              ) : null}
            </Text>
            {props.environmentLabel && props.environmentMachine ? (
              <EnvironmentMachineSymbol
                kind={props.environmentMachine}
                size={11}
                tintColorClassName={
                  selected
                    ? selectedThreadRowColors.mutedIconTintClassName
                    : rowAppearance.tertiaryIconTintClassName
                }
              />
            ) : null}
          </View>
        ) : (
          <View className="flex-1" />
        )}
        {pr ? (
          <Pressable
            // Padding cancelled by negative margin grows the touch target into
            // the row padding without moving the badge.
            className="-m-2.5 flex-row items-center gap-1 p-2.5"
            accessibilityRole="button"
            accessibilityLabel={prBadgeLabel ?? undefined}
            onPress={handleOpenPullRequests}
            // Without a long-press handler a hold that opens the row's iOS
            // context menu would also open the pull request on release.
            onLongPress={() => undefined}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <SymbolView
              name={
                pr.kind === "stack"
                  ? PullRequestGlyph.stack
                  : pr.state === null
                    ? PullRequestGlyph.pullRequest
                    : pullRequestStatus({ state: pr.state, isDraft: pr.isDraft }).icon
              }
              size={12}
              tintColorClassName={
                pr.state === null || pr.isDraft
                  ? rowAppearance.mutedIconTintClassName
                  : pr.state === "open"
                    ? "accent-adaptive-emerald-600-400"
                    : pr.state === "closed"
                      ? "accent-adaptive-rose-600-400"
                      : "accent-adaptive-violet-600-400"
              }
            />
            <Text
              accessibilityLabel={pr.accessibilityLabel}
              className={cn("text-xs", pr.textClassName)}
              style={{ fontFamily: MONO_FONT }}
            >
              {pr.label}
            </Text>
          </Pressable>
        ) : null}
        {providerInstance ? (
          <View className="flex-row items-center">
            {providerDrivers.slice(0, -1).map((driver, index) => (
              <View key={`${driver}:${index}`} className="-mr-1 opacity-30">
                <ProviderIcon provider={driver} size={12} />
              </View>
            ))}
            <ProviderInstanceIcon
              iconUrl={providerIconUrl}
              provider={providerInstance.driverKind}
              size={14}
              displayName={providerInstance.displayName}
              accentColor={providerInstance.accentColor}
              showBadge={providerInstance.showBadge}
              surfaceColor={providerIconSurfaceColor}
            />
          </View>
        ) : null}
      </View>
    </>
  );

  const fadedCardContent = recede ? (
    <View style={{ opacity: 0.55 }}>{cardContent}</View>
  ) : (
    cardContent
  );

  const rowContent = (close: () => void) =>
    variant === "card" ? (
      <RowPressable
        key={`${thread.environmentId}:${thread.id}`}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        className={rowAppearance.className}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={
          props.hasQueuedMessages ? `${thread.title}, messages queued to send` : thread.title
        }
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityActions={rowAccessibilityActions}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "openPullRequests") handleOpenPullRequests();
          if (event.nativeEvent.actionName === "dismissWoke") handleAcknowledgeWoke();
        }}
        onPress={() => {
          close();
          selectThread();
        }}
        style={rowCardStyle}
      >
        {sidebarPane ? (
          fadedCardContent
        ) : (
          <View>
            <View className={THREAD_LIST_V2_ROW_CONTENT_CLASS_NAME}>{fadedCardContent}</View>
            {THREAD_LIST_V2_ROW_DIVIDERS && props.showTrailingDivider !== false ? (
              <View className="ml-5 h-px bg-border-subtle" />
            ) : null}
          </View>
        )}
      </RowPressable>
    ) : (
      <RowPressable
        key={`${thread.environmentId}:${thread.id}`}
        interactionClassName={rowAppearance.interactionClassName}
        interactionOpacity={rowAppearance.interactionOpacity}
        accessibilityHint={swipeAccessibilityHint}
        accessibilityLabel={
          props.hasQueuedMessages ? `${thread.title}, messages queued to send` : thread.title
        }
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className={rowAppearance.className}
        onPress={() => {
          close();
          selectThread();
        }}
        style={rowStyle}
      >
        <View
          className={cn(
            "min-h-[44px] flex-row items-center gap-2.5 py-2",
            sidebarPane ? "px-3" : "px-5",
          )}
        >
          {props.project ? (
            <View className="opacity-40">
              <ProjectFavicon
                environmentId={thread.environmentId}
                faviconPath={props.project.faviconPath}
                projectIcon={props.project.projectIcon}
                size={15}
                projectTitle={props.project.title}
                workspaceRoot={props.project.workspaceRoot}
              />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text
              className={cn(
                "text-base",
                selected
                  ? selectedThreadRowColors.foregroundClassName
                  : rowAppearance.mutedForegroundClassName,
              )}
              numberOfLines={1}
            >
              {thread.title}
            </Text>
            {props.searchMatch ? (
              <ThreadSearchMatchExcerpt
                sidebar={sidebarPane}
                match={props.searchMatch}
                query={props.searchQuery ?? ""}
                selected={selected}
              />
            ) : null}
          </View>
          {props.hasQueuedMessages ? <QueuedMessageIcon selected={selected} /> : null}
          {/* A blocked row replaces the timestamp with what it waits on. It
              is prose rather than a countdown, so it drops the mono face and
              truncates instead of squeezing the title. */}
          <Text
            className={cn(
              "text-sm",
              blockedRow && props.waitLabel != null ? "shrink" : "tabular-nums",
              selected
                ? selectedThreadRowColors.mutedForegroundClassName
                : snoozedRow || blockedRow
                  ? rowAppearance.mutedForegroundClassName
                  : rowAppearance.tertiaryForegroundClassName,
            )}
            numberOfLines={1}
            style={blockedRow && props.waitLabel != null ? undefined : { fontFamily: MONO_FONT }}
          >
            {blockedRow && props.waitLabel != null
              ? props.waitLabel
              : snoozedRow && props.snoozeWakeLabelText !== undefined
                ? props.snoozeWakeLabelText
                : timeLabel}
          </Text>
        </View>
      </RowPressable>
    );

  if (!canOperateThread)
    return <View style={rowAppearance.swipeContainerStyle}>{rowContent(() => {})}</View>;

  return (
    <View collapsable={false}>
      {customSnooze !== null && (
        <CustomSnoozeSheet
          onClose={() => setCustomSnooze(null)}
          onSnooze={handleSnooze}
          initialSnoozedUntil={thread.snoozedUntil}
          {...(props.snoozeReminderSupported
            ? {
                reminder: {
                  initialValue: resolveSnoozeReminder(thread, undefined) ?? "",
                  autoFocus: customSnooze === "reminder",
                },
              }
            : {})}
        />
      )}
      <ThreadSwipeable
        dormant={dormant}
        threadKey={`${thread.environmentId}:${thread.id}`}
        backgroundColor={rowAppearance.swipeBackgroundColor}
        compactActions={variant === "slim"}
        containerStyle={rowAppearance.swipeContainerStyle}
        enableTrackpadSwipe
        fullSwipeAction="primary"
        fullSwipeWidth={props.fullSwipeWidth ?? windowWidth - 32}
        onDelete={handleDelete}
        onSwipeableClose={props.onSwipeableClose}
        onSwipeableWillOpen={props.onSwipeableWillOpen}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        resetKey={`${thread.environmentId}:${thread.id}:${variant}:${snoozedRow}:${blockedRow}:${thread.settledAt}:${thread.unsettledAt}:${thread.snoozedUntil}:${thread.pinnedAt}`}
        simultaneousWith={props.simultaneousSwipeGesture}
        threadTitle={thread.title}
      >
        {(close) => (
          <Menu
            actions={[
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      title: getThreadListV2NewBranchMenuTitle(thread.branch),
                      image: "square.and.pencil",
                    },
                  ]
                : []),
              ...(props.continueSupported
                ? [
                    {
                      id: "continue-in-new-thread",
                      title: "Continue in new thread",
                      image: "arrow.turn.down.right",
                    },
                  ]
                : []),
              { id: "copy-thread-id", title: "Copy thread ID", image: "doc.on.doc" },
              { id: "copy-thread-chip", title: "Copy thread chip", image: "link" },
              ...(blockedRow
                ? blockedMenuActions
                : snoozedRow
                  ? snoozedMenuActions
                  : !props.settlementSupported
                    ? legacyMenuActions
                    : canUnsettle
                      ? slimMenuActions
                      : swipeActions.secondary === "snooze"
                        ? snoozableCardMenuActions
                        : cardMenuActions),
            ]}
            onPressAction={handleMenuAction}
            shouldOpenOnLongPress
          >
            {rowContent(close)}
          </Menu>
        )}
      </ThreadSwipeable>
    </View>
  );
});
