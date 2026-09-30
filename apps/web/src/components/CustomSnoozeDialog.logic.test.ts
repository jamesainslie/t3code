import { describe, expect, it } from "vite-plus/test";

import {
  customSnoozeOptions,
  resolveDialogReminder,
  resolveDialogSnoozedUntil,
} from "./CustomSnoozeDialog.logic";

describe("resolveDialogReminder", () => {
  it("sends nothing when the field was left empty and there was no note", () => {
    expect(resolveDialogReminder("", null)).toBeUndefined();
    expect(resolveDialogReminder("   ", null)).toBeUndefined();
  });

  it("clears an existing note when the field is emptied", () => {
    expect(resolveDialogReminder("  ", "Check the deploy")).toBe("");
  });

  it("sends the trimmed note otherwise", () => {
    expect(resolveDialogReminder("  Check the deploy \n", null)).toBe("Check the deploy");
    expect(resolveDialogReminder("New note", "Old note")).toBe("New note");
  });
});

describe("customSnoozeOptions", () => {
  it("pre-fills a snoozed thread's wake time and note", () => {
    expect(
      customSnoozeOptions({
        focusReminder: true,
        supportsReminder: true,
        snoozed: { snoozedUntil: "2026-09-30T15:00:00.000Z", snoozeReminder: "Check the deploy" },
      }),
    ).toEqual({
      reminder: { initial: "Check the deploy", focus: true },
      snoozedUntil: "2026-09-30T15:00:00.000Z",
    });
  });

  it("starts empty for a thread that is not snoozed", () => {
    expect(
      customSnoozeOptions({ focusReminder: false, supportsReminder: true, snoozed: null }),
    ).toEqual({ reminder: { initial: null, focus: false } });
  });

  it("hides the reminder field for a server without reminders", () => {
    expect(
      customSnoozeOptions({ focusReminder: false, supportsReminder: false, snoozed: null }),
    ).toEqual({});
  });
});

describe("resolveDialogSnoozedUntil", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const schedule = { mode: "duration", amount: "2", unit: "hours" } as const;

  it("resolves the schedule for a fresh snooze", () => {
    expect(
      resolveDialogSnoozedUntil({
        schedule,
        initialSnoozedUntil: null,
        scheduleTouched: false,
        now,
      }),
    ).toBe("2026-09-30T14:00:00.000Z");
  });

  it("keeps a snoozed thread's exact wake time until the schedule is changed", () => {
    const initialSnoozedUntil = "2026-09-30T15:30:42.123Z";
    expect(
      resolveDialogSnoozedUntil({ schedule, initialSnoozedUntil, scheduleTouched: false, now }),
    ).toBe(initialSnoozedUntil);
    expect(
      resolveDialogSnoozedUntil({ schedule, initialSnoozedUntil, scheduleTouched: true, now }),
    ).toBe("2026-09-30T14:00:00.000Z");
  });

  it("rejects a kept wake time that passed while the dialog was open", () => {
    expect(
      resolveDialogSnoozedUntil({
        schedule,
        initialSnoozedUntil: "2026-09-30T11:59:59.000Z",
        scheduleTouched: false,
        now,
      }),
    ).toBeNull();
  });
});
