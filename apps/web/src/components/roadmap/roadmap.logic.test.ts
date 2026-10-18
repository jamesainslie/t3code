import { describe, expect, it } from "vite-plus/test";

import {
  ROADMAP_TYPE_LABELS,
  criteriaProgress,
  localIsoDate,
  workingDaysLeft,
} from "./roadmap.logic";

const at = "2026-10-18T09:00:00.000Z";

describe("ROADMAP_TYPE_LABELS", () => {
  it("names every type", () => {
    expect(Object.keys(ROADMAP_TYPE_LABELS)).toHaveLength(8);
    expect(ROADMAP_TYPE_LABELS["support-ticket"]).toBe("Support ticket");
  });
});

describe("criteriaProgress", () => {
  it("counts ticked criteria over the total", () => {
    const criterion = (text: string, ticked: boolean) => ({
      id: text,
      text,
      tickedAt: ticked ? at : null,
      tickedBy: ticked ? ({ _tag: "user" } as const) : null,
      evidence: null,
    });
    expect(criteriaProgress([criterion("a", true), criterion("b", false)])).toEqual({
      ticked: 1,
      total: 2,
    });
    expect(criteriaProgress([])).toEqual({ ticked: 0, total: 0 });
  });
});

describe("workingDaysLeft", () => {
  // 2026-10-19 is a Monday.
  it("counts the weekdays after today up to and including the due date", () => {
    expect(workingDaysLeft("2026-10-19", "2026-10-23")).toBe(4);
    expect(workingDaysLeft("2026-10-23", "2026-10-26")).toBe(1);
    expect(workingDaysLeft("2026-10-19", "2026-10-30")).toBe(9);
  });

  it("is zero on the due date and over a weekend before it", () => {
    expect(workingDaysLeft("2026-10-19", "2026-10-19")).toBe(0);
    expect(workingDaysLeft("2026-10-23", "2026-10-23")).toBe(0);
    expect(workingDaysLeft("2026-10-23", "2026-10-25")).toBe(0);
  });

  it("goes negative by the weekdays already past the due date", () => {
    expect(workingDaysLeft("2026-10-19", "2026-10-16")).toBe(-1);
    expect(workingDaysLeft("2026-10-19", "2026-10-15")).toBe(-2);
    expect(workingDaysLeft("2026-10-26", "2026-10-23")).toBe(-1);
    expect(workingDaysLeft("2026-11-02", "2026-10-23")).toBe(-6);
  });

  it("counts overdue days after the due date, so a weekend due date is late by Monday", () => {
    expect(workingDaysLeft("2026-10-26", "2026-10-24")).toBe(-1);
    expect(workingDaysLeft("2026-10-24", "2026-10-23")).toBe(0);
  });

  it("crosses month and year ends", () => {
    expect(workingDaysLeft("2026-12-31", "2027-01-04")).toBe(2);
  });
});

describe("localIsoDate", () => {
  it("reads the calendar date in local time", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
