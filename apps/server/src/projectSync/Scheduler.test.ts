import { expect, it } from "vite-plus/test";
import { isSyncDue } from "./Scheduler.ts";

it("catches up once after sleep, observes pause, and does not retry a failed night indefinitely", () => {
  const configuration = {
    enabled: true,
    hour: 3,
    timezone: "America/New_York",
    lastAttemptAt: "2026-09-06T07:00:00Z",
    lastSuccessAt: "2026-09-06T07:00:00Z",
  };
  expect(isSyncDue(configuration, "2026-09-07T06:59:00Z")).toBe(false);
  expect(isSyncDue(configuration, "2026-09-07T14:00:00Z")).toBe(true);
  expect(isSyncDue({ ...configuration, enabled: false }, "2026-09-07T14:00:00Z")).toBe(false);
  expect(
    isSyncDue({ ...configuration, lastAttemptAt: "2026-09-07T14:00:00Z" }, "2026-09-07T15:00:00Z"),
  ).toBe(false);
  expect(
    isSyncDue({ ...configuration, lastAttemptAt: "2026-09-07T14:00:00Z" }, "2026-09-08T08:00:00Z"),
  ).toBe(true);
});

it("runs once across daylight-saving clock changes", () => {
  const configuration = {
    enabled: true,
    hour: 2,
    timezone: "America/New_York",
    lastAttemptAt: "2026-03-07T07:00:00Z",
    lastSuccessAt: "2026-03-07T07:00:00Z",
  };
  expect(isSyncDue(configuration, "2026-03-08T07:00:00Z")).toBe(true);
  expect(
    isSyncDue({ ...configuration, lastAttemptAt: "2026-03-08T07:00:00Z" }, "2026-03-08T08:00:00Z"),
  ).toBe(false);
});
