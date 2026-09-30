import { describe, expect, it } from "vite-plus/test";

import {
  applySnoozePickerDate,
  applySnoozePickerTime,
  initialCustomSnoozeDate,
  snoozeDateToPickerDate,
} from "./customSnoozeDate";

describe("custom snooze calendar conversion", () => {
  it("passes the local calendar day to Compose without shifting it across time zones", () => {
    const date = new Date(2026, 8, 17, 0, 30);
    expect(snoozeDateToPickerDate(date)).toBe("2026-09-17T00:00:00.000Z");
  });

  it("applies Compose's UTC calendar day while retaining the local time", () => {
    const date = new Date(2026, 8, 16, 23, 45);
    const next = applySnoozePickerDate(date, new Date("2026-09-20T00:00:00Z"));
    expect([
      next.getFullYear(),
      next.getMonth(),
      next.getDate(),
      next.getHours(),
      next.getMinutes(),
    ]).toEqual([2026, 8, 20, 23, 45]);
    expect(date.getDate()).toBe(16);
  });

  it("applies a picked local time without changing the chosen calendar day", () => {
    const date = new Date(2026, 8, 20, 23, 45);
    const next = applySnoozePickerTime(date, new Date(2026, 8, 16, 8, 15, 30));
    expect([next.getDate(), next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([
      20, 8, 15, 0,
    ]);
    expect(date.getHours()).toBe(23);
  });
});

describe("initial custom snooze date", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");

  it("starts an hour out when the thread is not snoozed", () => {
    expect(initialCustomSnoozeDate(null, now).toISOString()).toBe("2026-09-30T13:00:00.000Z");
    expect(initialCustomSnoozeDate(undefined, now).toISOString()).toBe("2026-09-30T13:00:00.000Z");
  });

  it("starts at the current wake time when re-snoozing, so only the note has to change", () => {
    expect(initialCustomSnoozeDate("2026-10-02T09:00:00.000Z", now).toISOString()).toBe(
      "2026-10-02T09:00:00.000Z",
    );
  });

  it("ignores a wake time that has passed or does not parse", () => {
    expect(initialCustomSnoozeDate("2026-09-30T11:00:00.000Z", now).toISOString()).toBe(
      "2026-09-30T13:00:00.000Z",
    );
    expect(initialCustomSnoozeDate("not a date", now).toISOString()).toBe(
      "2026-09-30T13:00:00.000Z",
    );
  });
});
