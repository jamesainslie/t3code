import {
  resolveCustomSnooze,
  type CustomSnoozeInput,
} from "@t3tools/client-runtime/state/thread-settled";

/** A snooze pick. `reminder` follows thread.snooze: absent keeps any note, "" clears it. */
export interface SnoozeChoice {
  readonly snoozedUntil: string;
  readonly reminder?: string;
}

export interface CustomSnoozeOptions {
  /**
   * Shows the reminder field, pre-filled with `initial`. Omitted where the
   * server does not accept reminders.
   */
  readonly reminder?: { readonly initial: string | null; readonly focus: boolean };
  /** Editing a snoozed thread: start from its wake time and keep it unless changed. */
  readonly snoozedUntil?: string;
}

/**
 * Dialog options for a menu's `snooze:custom` or `snooze:reminder` pick.
 * `snoozed` is the thread when it is snoozed right now, so the dialog edits
 * its wake time and note instead of starting fresh.
 */
export function customSnoozeOptions(input: {
  readonly focusReminder: boolean;
  readonly supportsReminder: boolean;
  readonly snoozed: {
    readonly snoozedUntil: string | null;
    readonly snoozeReminder?: string | null | undefined;
  } | null;
}): CustomSnoozeOptions {
  const snoozedUntil = input.snoozed?.snoozedUntil;
  return {
    ...(input.supportsReminder
      ? {
          reminder: {
            initial: input.snoozed?.snoozeReminder ?? null,
            focus: input.focusReminder,
          },
        }
      : {}),
    ...(snoozedUntil ? { snoozedUntil } : {}),
  };
}

/**
 * The `reminder` the dialog sends on thread.snooze. An empty field that never
 * held a note sends nothing (keep); emptying an existing note sends "" (clear).
 */
export function resolveDialogReminder(
  value: string,
  initialReminder: string | null,
): string | undefined {
  const note = value.trim();
  if (note) return note;
  return initialReminder ? "" : undefined;
}

/**
 * The wake time the dialog submits. Editing a snoozed thread keeps its exact
 * wake time until the user changes the schedule, so editing only the note
 * does not round the wake time to the minute.
 */
export function resolveDialogSnoozedUntil(input: {
  readonly schedule: CustomSnoozeInput;
  readonly initialSnoozedUntil: string | null;
  readonly scheduleTouched: boolean;
  readonly now: Date;
}): string | null {
  if (input.initialSnoozedUntil === null || input.scheduleTouched) {
    return resolveCustomSnooze(input.schedule, input.now);
  }
  return Date.parse(input.initialSnoozedUntil) > input.now.getTime()
    ? input.initialSnoozedUntil
    : null;
}
