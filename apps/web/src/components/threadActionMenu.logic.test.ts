import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  branch: null,
  projectFilter: null,
  isPinned: false,
  highlightColor: null,
  highlightPalette: Array.from({ length: 12 }, (_, index) => ({
    label: `Color ${index + 1}`,
    color: `#${(index + 1).toString(16).padStart(2, "0")}0000`,
  })),
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isBlocked: false,
  canAddDependencyNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    highlight: true,
    titleRegeneration: true,
    dependencies: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

function allIds(state: ThreadActionMenuState): string[] {
  const flatten = (items: ReturnType<typeof buildThreadActionMenuItems>): string[] =>
    items.flatMap((item) => [item.id, ...(item.children ? flatten(item.children) : [])]);
  return flatten(buildThreadActionMenuItems(state));
}

describe("buildThreadActionMenuItems", () => {
  it("offers Default plus every palette slot under Highlight and marks the current one", () => {
    const items = buildThreadActionMenuItems({ ...baseState, highlightColor: "#020000" });
    const highlight = items.find((item) => item.id === "highlight");
    expect(highlight?.children?.map((child) => child.id)).toEqual([
      "highlight:default",
      ...Array.from({ length: 12 }, (_, index) => `highlight:${index}`),
    ]);
    expect(highlight?.children?.[0]?.label).toBe("Default");
    expect(highlight?.children?.[2]?.label).toBe("Color 2 ✓");
    expect(
      buildThreadActionMenuItems(baseState).find((item) => item.id === "highlight")?.children?.[0]
        ?.label,
    ).toBe("Default ✓");
  });

  it("hides Highlight when the environment lacks the capability", () => {
    expect(
      ids({ ...baseState, supports: { ...baseState.supports, highlight: false } }),
    ).not.toContain("highlight");
  });

  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: {
          settlement: false,
          autoSettleOptOut: false,
          snooze: false,
          pinning: false,
          highlight: false,
          titleRegeneration: false,
          dependencies: false,
        },
      }),
    ).toEqual(["rename", "mark-unread", "copy", "project-settings", "archive", "delete"]);
  });

  it("groups project settings with utility actions before archive", () => {
    const items = buildThreadActionMenuItems(baseState);
    const copyIndex = items.findIndex((item) => item.id === "copy");
    expect(items[copyIndex + 1]).toMatchObject({
      id: "project-settings",
      label: "Project settings",
      icon: "settings",
    });
    expect(items[copyIndex + 2]?.id).toBe("archive");
  });

  it("offers project filtering only for surfaces with a scoped thread list", () => {
    expect(ids(baseState)).not.toContain("filter-by-project");
    expect(
      buildThreadActionMenuItems({
        ...baseState,
        projectFilter: { label: "Beta Project", isActive: false },
      }).find((item) => item.id === "filter-by-project"),
    ).toMatchObject({ label: "Filter by Beta Project", icon: "folder-tree" });
  });

  it("offers the way back to all projects once the list is scoped", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      projectFilter: { label: "Beta Project", isActive: true },
    });
    const filterIndex = items.findIndex((candidate) => candidate.id === "filter-by-project");
    expect(items[filterIndex]).toMatchObject({ label: "Show all projects", icon: "folder-tree" });
    expect(items[filterIndex - 1]?.id).toBe("mark-unread");
    expect(items[filterIndex + 1]?.id).toBe("auto-settle");
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = allIds({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(withBranch).toContain("copy-branch");
    expect(allIds(baseState)).not.toContain("new-thread-on-branch");
    expect(allIds(baseState)).not.toContain("copy-branch");
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("offers auto-settle as a submenu with the current option checked", () => {
    const find = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state).find((item) => item.id === "auto-settle");
    const on = find(baseState);
    expect(on?.label).toBe("Auto-settle behavior");
    expect(on?.children?.map((child) => [child.id, child.checked])).toEqual([
      ["auto-settle:enabled", true],
      ["auto-settle:disabled", false],
    ]);
    const off = find({ ...baseState, autoSettleEnabled: false });
    expect(off?.children?.map((child) => child.checked)).toEqual([false, true]);
    // Sits with the per-thread settings after Mark unread, not the lifecycle verbs.
    const items = buildThreadActionMenuItems(baseState);
    expect(items[items.findIndex((item) => item.id === "mark-unread") + 1]?.id).toBe("auto-settle");
    expect(
      ids({ ...baseState, supports: { ...baseState.supports, autoSettleOptOut: false } }),
    ).not.toContain("auto-settle");
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour", "snooze:custom"]);
  });

  it("offers the dependency entries directly after snooze", () => {
    const items = buildThreadActionMenuItems(baseState);
    const snoozeIndex = items.findIndex((item) => item.id === "snooze");
    expect(items[snoozeIndex + 1]).toMatchObject({ id: "depends-on", label: "Depends on…" });
    expect(items[snoozeIndex + 2]).toMatchObject({
      id: "new-thread-to-unblock",
      label: "Start a thread to unblock this",
    });
  });

  it("disables the dependency entries when the thread cannot take one", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canAddDependencyNow: false });
    expect(items.find((item) => item.id === "depends-on")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "new-thread-to-unblock")?.disabled).toBe(true);
  });

  it("hides the dependency entries when the environment lacks the capability", () => {
    const withoutDependencies = ids({
      ...baseState,
      supports: { ...baseState.supports, dependencies: false },
    });
    expect(withoutDependencies).not.toContain("depends-on");
    expect(withoutDependencies).not.toContain("new-thread-to-unblock");
    expect(withoutDependencies).toContain("snooze");
  });

  it("offers wake in place of the parking entries on a blocked thread", () => {
    const items = ids({ ...baseState, isBlocked: true });
    expect(items).toContain("release");
    expect(items).not.toContain("depends-on");
    expect(items).not.toContain("new-thread-to-unblock");
    expect(items).not.toContain("snooze");
  });

  it("labels the blocked wake entry like the snoozed one", () => {
    const release = buildThreadActionMenuItems({ ...baseState, isBlocked: true }).find(
      (item) => item.id === "release",
    );
    expect(release).toMatchObject({ label: "Wake thread", icon: "clock" });
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });
  it("offers archive as a non-destructive action right before delete", () => {
    const items = buildThreadActionMenuItems(baseState);
    const archiveItem = items.at(-2);
    expect(archiveItem?.id).toBe("archive");
    expect(archiveItem?.icon).toBe("archive");
    expect(archiveItem?.separatorBefore).toBe(true);
    expect(archiveItem?.destructive).toBeFalsy();
    expect(items.at(-1)?.id).toBe("delete");
  });

  it("keeps archive available even when the environment lacks every other capability", () => {
    expect(
      ids({
        ...baseState,
        supports: {
          settlement: false,
          autoSettleOptOut: false,
          snooze: false,
          pinning: false,
          highlight: false,
          titleRegeneration: false,
          dependencies: false,
        },
      }),
    ).toContain("archive");
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});
