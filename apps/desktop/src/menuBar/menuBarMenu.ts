import type { EnvironmentId, ThreadId } from "@lathe/contracts";

import type { MenuBarSummary, MenuBarThreadItem, MenuBarThreadKind } from "./menuBarSummary.ts";

export type MenuBarAction =
  | {
      readonly _tag: "open-thread";
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
    }
  | { readonly _tag: "new-thread" }
  | { readonly _tag: "open-app" }
  | { readonly _tag: "quit" };

export type MenuBarMenuEntry =
  | { readonly type: "separator" }
  | {
      readonly type: "item";
      readonly label: string;
      readonly sublabel?: string;
      readonly enabled: boolean;
      readonly action?: MenuBarAction;
    };

const SECTION_LIMIT = 8;

const KIND_LABELS: Record<MenuBarThreadKind, string> = {
  approval: "Needs approval",
  input: "Has a question",
  request: "Guest message",
  working: "Working",
  waiting: "Waiting on a thread",
  done: "Done",
  failed: "Failed",
};

function elapsed(since: string | null, now: string): string | null {
  if (since === null) return null;
  const minutes = Math.floor((Date.parse(now) - Date.parse(since)) / 60_000);
  if (Number.isNaN(minutes)) return null;
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

function threadEntry(
  item: MenuBarThreadItem,
  now: string,
  showEnvironment: boolean,
): MenuBarMenuEntry {
  const sublabel = [
    KIND_LABELS[item.kind],
    item.projectTitle,
    showEnvironment ? item.environmentLabel : null,
    elapsed(item.since, now),
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return {
    type: "item",
    label: item.title,
    sublabel,
    enabled: true,
    action: { _tag: "open-thread", environmentId: item.environmentId, threadId: item.threadId },
  };
}

function section(
  title: string,
  items: ReadonlyArray<MenuBarThreadItem>,
  now: string,
  showEnvironment: boolean,
): ReadonlyArray<MenuBarMenuEntry> {
  if (items.length === 0) return [];
  const shown = items
    .slice(0, SECTION_LIMIT)
    .map((item) => threadEntry(item, now, showEnvironment));
  const more = items.length - shown.length;
  return [
    { type: "item", label: title, enabled: false },
    ...shown,
    ...(more > 0
      ? [
          {
            type: "item" as const,
            label: `${more} more...`,
            enabled: true,
            action: { _tag: "open-app" as const },
          },
        ]
      : []),
    { type: "separator" },
  ];
}

export function menuBarMenu(
  summary: MenuBarSummary,
  now: string,
  showEnvironment: boolean,
): ReadonlyArray<MenuBarMenuEntry> {
  const threads = [
    ...section("Needs you", summary.needsYou, now, showEnvironment),
    ...section("Running", summary.running, now, showEnvironment),
    ...section("Finished", summary.finished, now, showEnvironment),
  ];
  const unavailable: ReadonlyArray<MenuBarMenuEntry> =
    summary.unavailable.length === 0
      ? []
      : [
          ...summary.unavailable.map((environment): MenuBarMenuEntry => ({
            type: "item",
            label: `${environment.label} unavailable`,
            sublabel: environment.reason,
            enabled: false,
          })),
          { type: "separator" },
        ];
  return [
    ...(threads.length === 0
      ? [
          { type: "item" as const, label: "No threads need you", enabled: false },
          { type: "separator" as const },
        ]
      : threads),
    ...unavailable,
    { type: "item", label: "New Thread", enabled: true, action: { _tag: "new-thread" } },
    { type: "item", label: "Open Lathe", enabled: true, action: { _tag: "open-app" } },
    { type: "separator" },
    { type: "item", label: "Quit Lathe", enabled: true, action: { _tag: "quit" } },
  ];
}
