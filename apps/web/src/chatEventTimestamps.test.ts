import { describe, expect, it } from "vite-plus/test";

import {
  formatChatEventTimestamp,
  formatChatEventTimestampTooltip,
  resolveChatEventTimestampOptions,
} from "./chatEventTimestamps";
import { getTimestampFormatter } from "./timestampFormat";

// Instants are built with the local-time Date constructor so calendar-day
// boundaries and the ISO digits hold in any test timezone or locale.
const at = (y: number, monthIndex: number, d: number, h: number, mi: number, s: number) =>
  new Date(y, monthIndex, d, h, mi, s);
const now = at(2026, 8, 29, 12, 0, 0).getTime();

describe("resolveChatEventTimestampOptions", () => {
  it("is null while event timestamps are off", () => {
    expect(
      resolveChatEventTimestampOptions({
        chatEventTimestampsEnabled: false,
        chatEventTimestampStyle: "iso",
        chatEventTimestampSeconds: true,
      }),
    ).toBeNull();
  });

  it("carries the style and seconds choice once on", () => {
    expect(
      resolveChatEventTimestampOptions({
        chatEventTimestampsEnabled: true,
        chatEventTimestampStyle: "date-time",
        chatEventTimestampSeconds: false,
      }),
    ).toEqual({ style: "date-time", seconds: false });
  });
});

describe("formatChatEventTimestamp", () => {
  const event = at(2026, 8, 29, 9, 30, 5);
  const iso = event.toISOString();

  it("shows the clock time with seconds for an event from today", () => {
    expect(formatChatEventTimestamp(iso, "24-hour", { style: "time", seconds: true }, now)).toBe(
      getTimestampFormatter("24-hour", true).format(event),
    );
  });

  it("drops seconds when they are turned off", () => {
    expect(formatChatEventTimestamp(iso, "12-hour", { style: "time", seconds: false }, now)).toBe(
      getTimestampFormatter("12-hour", false).format(event),
    );
  });

  it("adds the day once the event is no longer from today", () => {
    const yesterday = at(2026, 8, 28, 23, 59, 59);
    expect(
      formatChatEventTimestamp(
        yesterday.toISOString(),
        "24-hour",
        { style: "time", seconds: true },
        now,
      ),
    ).toBe(`yesterday at ${getTimestampFormatter("24-hour", true).format(yesterday)}`);

    const older = formatChatEventTimestamp(
      at(2026, 8, 20, 8, 0, 1).toISOString(),
      "24-hour",
      { style: "time", seconds: true },
      now,
    );
    expect(older).not.toContain("yesterday");
    expect(older).toContain("20");
  });

  it("always shows the date in the date and time style", () => {
    const label = formatChatEventTimestamp(
      iso,
      "24-hour",
      { style: "date-time", seconds: true },
      now,
    );
    expect(label).toContain("2026");
    expect(label).toContain(getTimestampFormatter("24-hour", true).format(event));
  });

  it("writes a sortable local timestamp in the ISO style regardless of clock format", () => {
    expect(formatChatEventTimestamp(iso, "12-hour", { style: "iso", seconds: true }, now)).toBe(
      "2026-09-29 09:30:05",
    );
    expect(formatChatEventTimestamp(iso, "locale", { style: "iso", seconds: false }, now)).toBe(
      "2026-09-29 09:30",
    );
  });

  it("returns an empty label for an unparseable instant", () => {
    expect(formatChatEventTimestamp("not a date", "locale", { style: "iso", seconds: true })).toBe(
      "",
    );
  });
});

describe("formatChatEventTimestampTooltip", () => {
  it("gives the full local date and time with seconds", () => {
    const event = at(2026, 8, 29, 9, 30, 5);
    const label = formatChatEventTimestampTooltip(event.toISOString(), "24-hour");
    expect(label).toContain("2026");
    expect(label).toContain(getTimestampFormatter("24-hour", true).format(event));
  });

  it("names both ends of a span", () => {
    const start = at(2026, 8, 29, 9, 30, 5);
    const end = at(2026, 8, 29, 9, 41, 12);
    const time = (date: Date) => getTimestampFormatter("24-hour", true).format(date);
    const [started, finished] = formatChatEventTimestampTooltip(
      end.toISOString(),
      "24-hour",
      start.toISOString(),
    ).split("\n");
    expect(started).toMatch(/^Started /);
    expect(started).toContain(time(start));
    expect(finished).toMatch(/^Finished /);
    expect(finished).toContain(time(end));
  });
});
