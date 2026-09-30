/** Where the custom snooze picker starts: the current wake time when the
    thread is still snoozed, otherwise an hour from now. */
export function initialCustomSnoozeDate(snoozedUntil: string | null | undefined, now: Date): Date {
  const wakeAtMs = snoozedUntil == null ? Number.NaN : Date.parse(snoozedUntil);
  return Number.isFinite(wakeAtMs) && wakeAtMs > now.getTime()
    ? new Date(wakeAtMs)
    : new Date(now.getTime() + 3_600_000);
}

/** Compose calendars exchange calendar days at UTC midnight, not local instants. */
export function snoozeDateToPickerDate(date: Date): string {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

export function applySnoozePickerDate(date: Date, selected: Date): Date {
  const next = new Date(date);
  next.setFullYear(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate());
  return next;
}

export function applySnoozePickerTime(date: Date, selected: Date): Date {
  const next = new Date(date);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
}
