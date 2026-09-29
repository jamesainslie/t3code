import type {
  ChatEventTimestampStyle,
  ClientSettings,
  TimestampFormat,
} from "@t3tools/contracts/settings";

import { getTimestampFormatter, parseTimestampDate, timestampLocale } from "./timestampFormat";

/**
 * Always-visible chat event timestamps (fork feature). `null` keeps the
 * upstream behavior: event times appear on hover, without seconds.
 */
export interface ChatEventTimestampOptions {
  readonly style: ChatEventTimestampStyle;
  readonly seconds: boolean;
}

export function resolveChatEventTimestampOptions(
  settings: Pick<
    ClientSettings,
    "chatEventTimestampsEnabled" | "chatEventTimestampStyle" | "chatEventTimestampSeconds"
  >,
): ChatEventTimestampOptions | null {
  return settings.chatEventTimestampsEnabled
    ? { style: settings.chatEventTimestampStyle, seconds: settings.chatEventTimestampSeconds }
    : null;
}

const numericDateFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
});
const numericDateWithYearFormatter = new Intl.DateTimeFormat(timestampLocale, {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});
const fullDateFormatter = new Intl.DateTimeFormat(timestampLocale, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const timeZoneFormatter = new Intl.DateTimeFormat(timestampLocale, { timeZoneName: "short" });

const pad = (value: number) => String(value).padStart(2, "0");

function formatIsoLocal(date: Date, seconds: boolean): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${day} ${seconds ? `${time}:${pad(date.getSeconds())}` : time}`;
}

/**
 * Local wall-clock label for a timeline event. The `time` style reads like the
 * existing chat timestamps (`yesterday at …`, then a numeric date) but can carry
 * seconds; `date-time` always leads with the date; `iso` is 24-hour and sortable.
 */
export function formatChatEventTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  options: ChatEventTimestampOptions,
  nowMs: number = Date.now(),
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  if (options.style === "iso") return formatIsoLocal(date, options.seconds);

  const time = getTimestampFormatter(timestampFormat, options.seconds).format(date);
  if (options.style === "date-time") {
    return `${numericDateWithYearFormatter.format(date)} ${time}`;
  }

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfEventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Round so DST-shifted 23/25 hour days still count as whole days.
  const dayDiff = Math.round((startOfToday - startOfEventDay) / 86_400_000);
  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return `yesterday at ${time}`;
  const dateFormatter =
    date.getFullYear() === now.getFullYear() ? numericDateFormatter : numericDateWithYearFormatter;
  return `${dateFormatter.format(date)} ${time}`;
}

function formatFullLocalTime(date: Date, timestampFormat: TimestampFormat): string {
  const zone = timeZoneFormatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const time = getTimestampFormatter(timestampFormat, true).format(date);
  return `${fullDateFormatter.format(date)}, ${time}${zone ? ` ${zone}` : ""}`;
}

/**
 * Tooltip with the full local date, seconds, and time zone. With `startIso`
 * it describes a span, such as a run that ended at `isoDate`.
 */
export function formatChatEventTimestampTooltip(
  isoDate: string,
  timestampFormat: TimestampFormat,
  startIso?: string,
): string {
  const date = parseTimestampDate(isoDate);
  if (!date) return "";
  const end = formatFullLocalTime(date, timestampFormat);
  const start = startIso ? parseTimestampDate(startIso) : null;
  return start ? `Started ${formatFullLocalTime(start, timestampFormat)}\nFinished ${end}` : end;
}
