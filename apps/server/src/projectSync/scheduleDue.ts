import type { ProjectSyncConfiguration } from "@t3tools/contracts";

/** Calendar buckets avoid double runs on clock changes and allow a missed night to catch up. */
export function isSyncDue(
  configuration: Pick<
    ProjectSyncConfiguration,
    "enabled" | "hour" | "timezone" | "lastAttemptAt" | "lastSuccessAt"
  >,
  now: string,
): boolean {
  if (!configuration.enabled) return false;
  const bucket = (value: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: configuration.timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(Date.parse(value));
    const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(
      number("year"),
      number("month") - 1,
      number("day") - (number("hour") < configuration.hour ? 1 : 0),
    );
  };
  const previous = configuration.lastAttemptAt ?? configuration.lastSuccessAt;
  return previous === null || bucket(previous) < bucket(now);
}
