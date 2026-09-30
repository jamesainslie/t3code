import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  SNOOZE_REMINDER_ACTIVITY_KIND,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// The decider's clock is the Effect test clock, pinned to the epoch, so
// "future" wake times are relative to 1970-01-01T00:00:00.000Z.
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";
const PAST_WAKE = "1969-12-31T09:00:00.000Z";
const SNOOZED_AT = "1969-12-30T00:00:00.000Z";

interface ThreadInput {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly snoozeReminder?: string | null;
  readonly archivedAt?: string | null;
  readonly pinnedAt?: string | null;
  readonly activities?: OrchestrationThread["activities"];
  readonly messages?: OrchestrationThread["messages"];
}

function makeThread(id: string, input: ThreadInput): OrchestrationThread {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: input.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: input.snoozedUntil ?? null,
    snoozedAt: input.snoozedAt ?? (input.snoozedUntil != null ? SNOOZED_AT : null),
    snoozeReminder: input.snoozeReminder ?? null,
    ...(input.pinnedAt !== undefined ? { pinnedAt: input.pinnedAt } : {}),
    deletedAt: null,
    messages: input.messages ?? [],
    proposedPlans: [],
    activities: input.activities ?? [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(
  input: ThreadInput & { readonly otherThreads?: ReadonlyArray<OrchestrationThread> },
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [makeThread("thread-1", input), ...(input.otherThreads ?? [])],
    updatedAt: NOW,
  };
}

// Distributes over the event union so a `type` check narrows the payload.
type PlannedEvent = OrchestrationEvent extends infer Event
  ? Event extends OrchestrationEvent
    ? Omit<Event, "sequence">
    : never
  : never;

function asEvents(
  result: Effect.Success<ReturnType<typeof decideOrchestrationCommand>>,
): ReadonlyArray<PlannedEvent> {
  return (Array.isArray(result) ? result : [result]) as ReadonlyArray<PlannedEvent>;
}

function reminderActivities(events: ReadonlyArray<PlannedEvent>) {
  return events.flatMap((event) =>
    event.type === "thread.activity-appended" &&
    event.payload.activity.kind === SNOOZE_REMINDER_ACTIVITY_KIND
      ? [event.payload.activity]
      : [],
  );
}

const REMINDER = "Check whether the deploy finished";

it.layer(NodeServices.layer)("snoozed thread decider", (it) => {
  it.effect("snoozes a thread to a future wake time", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.snoozed");
      if (events[0]?.type === "thread.snoozed") {
        expect(events[0].payload.snoozedUntil).toBe(FUTURE_WAKE);
        expect(events[0].payload.snoozedAt).toBe(events[0].payload.updatedAt);
      }
    }),
  );

  it.effect("rejects a wake time that is not in the future", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-past"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: PAST_WAKE,
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects an unparseable wake time", () =>
    Effect.gen(function* () {
      // IsoDateTime is structurally a string, so garbage can reach the
      // decider; a NaN wake time must never persist as snooze state.
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-garbage"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: "not-a-date",
        },
        readModel: makeReadModel({}),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects snoozing blocked-on-you work", () =>
    Effect.gen(function* () {
      const requestActivity = {
        id: EventId.make("activity-req-1"),
        tone: "approval" as const,
        kind: "approval.requested",
        summary: "approval.requested",
        payload: { requestId: "req-1" },
        turnId: null,
        createdAt: NOW,
      } as OrchestrationThread["activities"][number];
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-blocked"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({ activities: [requestActivity] }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("re-emits idempotently for a duplicate snooze to the same wake time", () =>
    Effect.gen(function* () {
      const reEmit = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-again"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const events = Array.isArray(reEmit) ? reEmit : [reEmit];
      expect(events).toHaveLength(1);
      if (events[0]?.type === "thread.snoozed") {
        // Original snoozedAt preserved; updatedAt must not churn.
        expect(events[0].payload.snoozedAt).toBe(SNOOZED_AT);
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("re-snoozing to a DIFFERENT wake time stamps fresh", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-extend"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: "1970-01-03T09:00:00.000Z",
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const events = Array.isArray(event) ? event : [event];
      if (events[0]?.type === "thread.snoozed") {
        expect(events[0].payload.snoozedUntil).toBe("1970-01-03T09:00:00.000Z");
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("unsnoozes with reason user and re-emits idempotently when awake", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.unsnooze",
          commandId: CommandId.make("cmd-unsnooze"),
          threadId: ThreadId.make("thread-1"),
          reason: "user",
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.unsnoozed");
      if (events[0]?.type === "thread.unsnoozed") {
        expect(events[0].payload.reason).toBe("user");
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }

      const awake = yield* decideOrchestrationCommand({
        command: {
          type: "thread.unsnooze",
          commandId: CommandId.make("cmd-unsnooze-awake"),
          threadId: ThreadId.make("thread-1"),
          reason: "user",
        },
        readModel: makeReadModel({}),
      });
      const awakeEvents = Array.isArray(awake) ? awake : [awake];
      expect(awakeEvents[0]?.type).toBe("thread.unsnoozed");
      if (awakeEvents[0]?.type === "thread.unsnoozed") {
        // No state change — keep the existing updatedAt.
        expect(awakeEvents[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("rejects snoozing a thread with a queued turn start", () =>
    Effect.gen(function* () {
      // The decider clock is the Effect test clock pinned to the epoch: a
      // user message 30s before it with no adopting turn is queued work.
      const queuedMessage = {
        id: MessageId.make("message-queued"),
        role: "user",
        text: "Continue",
        turnId: null,
        streaming: false,
        createdAt: "1969-12-31T23:59:30.000Z",
        updatedAt: "1969-12-31T23:59:30.000Z",
      } as OrchestrationThread["messages"][number];
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-queued"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({ messages: [queuedMessage] }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects snoozing an archived thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze-archived"),
          threadId: ThreadId.make("thread-1"),
          snoozedUntil: FUTURE_WAKE,
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("a user message spends the snooze return ticket (activity wake)", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
      });
      const events = Array.isArray(result) ? result : [result];
      const unsnoozed = events.find((entry) => entry.type === "thread.unsnoozed");
      expect(unsnoozed).toBeDefined();
      if (unsnoozed?.type === "thread.unsnoozed") {
        expect(unsnoozed.payload.reason).toBe("activity");
      }
    }),
  );
});

it.layer(NodeServices.layer)("snooze reminder decider", (it) => {
  const snooze = (
    readModel: OrchestrationReadModel,
    extra: { readonly reminder?: string; readonly snoozedUntil?: string } = {},
  ) =>
    decideOrchestrationCommand({
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("cmd-snooze-reminder"),
        threadId: ThreadId.make("thread-1"),
        snoozedUntil: extra.snoozedUntil ?? FUTURE_WAKE,
        ...(extra.reminder !== undefined ? { reminder: extra.reminder } : {}),
      },
      readModel,
    }).pipe(Effect.map(asEvents));

  const snoozedReminderOf = (events: ReadonlyArray<PlannedEvent>) => {
    const snoozed = events.find((event) => event.type === "thread.snoozed");
    return snoozed?.type === "thread.snoozed" ? snoozed.payload.reminder : "missing";
  };

  it.effect("a snooze with a reminder carries it on thread.snoozed", () =>
    Effect.gen(function* () {
      const events = yield* snooze(makeReadModel({}), { reminder: REMINDER });
      expect(snoozedReminderOf(events)).toBe(REMINDER);
    }),
  );

  it.effect("a snooze without a reminder on an awake thread resolves to null", () =>
    Effect.gen(function* () {
      const events = yield* snooze(makeReadModel({}));
      expect(snoozedReminderOf(events)).toBeNull();
    }),
  );

  it.effect("a re-snooze without a reminder keeps the pending note", () =>
    Effect.gen(function* () {
      const events = yield* snooze(
        makeReadModel({ snoozedUntil: FUTURE_WAKE, snoozeReminder: REMINDER }),
        { snoozedUntil: "1970-01-03T09:00:00.000Z" },
      );
      expect(snoozedReminderOf(events)).toBe(REMINDER);
    }),
  );

  it.effect("a re-snooze with an empty reminder clears the note", () =>
    Effect.gen(function* () {
      const events = yield* snooze(
        makeReadModel({ snoozedUntil: FUTURE_WAKE, snoozeReminder: REMINDER }),
        { reminder: "" },
      );
      expect(snoozedReminderOf(events)).toBeNull();
    }),
  );

  it.effect("a re-snooze with a new reminder replaces the note", () =>
    Effect.gen(function* () {
      const events = yield* snooze(
        makeReadModel({ snoozedUntil: FUTURE_WAKE, snoozeReminder: REMINDER }),
        { reminder: "Ping the reviewer" },
      );
      expect(snoozedReminderOf(events)).toBe("Ping the reviewer");
    }),
  );

  it.effect("editing only the note at the same wake time is a real change", () =>
    Effect.gen(function* () {
      const events = yield* snooze(
        makeReadModel({ snoozedUntil: FUTURE_WAKE, snoozeReminder: REMINDER }),
        { reminder: "Ping the reviewer" },
      );
      const snoozed = events.find((event) => event.type === "thread.snoozed");
      expect(snoozed?.type).toBe("thread.snoozed");
      if (snoozed?.type === "thread.snoozed") {
        expect(snoozed.payload.snoozedAt).toBe(SNOOZED_AT);
        expect(snoozed.payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  const pending = { snoozedUntil: FUTURE_WAKE, snoozeReminder: REMINDER } as const;

  const expectReminderBesideUnsnooze = (events: ReadonlyArray<PlannedEvent>) => {
    expect(events.filter((event) => event.type === "thread.unsnoozed")).toHaveLength(1);
    const activities = reminderActivities(events);
    expect(activities).toHaveLength(1);
    const activity = activities[0]!;
    expect(activity.summary).toBe(REMINDER);
    expect(activity.tone).toBe("info");
    expect(activity.turnId).toBeNull();
    expect(activity.payload).toEqual({
      reminder: REMINDER,
      snoozedAt: SNOOZED_AT,
      snoozedUntil: FUTURE_WAKE,
    });
    const activityEvent = events.find(
      (event) =>
        event.type === "thread.activity-appended" &&
        event.payload.activity.kind === SNOOZE_REMINDER_ACTIVITY_KIND,
    );
    expect(activityEvent?.aggregateId).toBe("thread-1");
  };

  it.effect("wake now delivers the pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.unsnooze",
            commandId: CommandId.make("cmd-unsnooze-reminder"),
            threadId: ThreadId.make("thread-1"),
            reason: "user",
          },
          readModel: makeReadModel(pending),
        }),
      );
      expectReminderBesideUnsnooze(events);
    }),
  );

  it.effect("settling a snoozed thread delivers the pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.settle",
            commandId: CommandId.make("cmd-settle-reminder"),
            threadId: ThreadId.make("thread-1"),
          },
          readModel: makeReadModel(pending),
        }),
      );
      expectReminderBesideUnsnooze(events);
    }),
  );

  it.effect("adding a dependency to a snoozed thread delivers the pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.dependency.add",
            commandId: CommandId.make("cmd-dependency-reminder"),
            threadId: ThreadId.make("thread-1"),
            dependsOnThreadId: ThreadId.make("thread-2"),
          },
          readModel: makeReadModel({ ...pending, otherThreads: [makeThread("thread-2", {})] }),
        }),
      );
      expectReminderBesideUnsnooze(events);
      // The engine records the receipt against the last event's aggregate.
      expect(events.at(-1)?.type).toBe("thread.dependency-added");
    }),
  );

  it.effect("pinning a snoozed thread delivers the pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.pin",
            commandId: CommandId.make("cmd-pin-reminder"),
            threadId: ThreadId.make("thread-1"),
          },
          readModel: makeReadModel(pending),
        }),
      );
      expectReminderBesideUnsnooze(events);
    }),
  );

  it.effect("a user message to a snoozed thread delivers the pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-turn-start-reminder"),
            threadId: ThreadId.make("thread-1"),
            message: {
              messageId: MessageId.make("message-reminder"),
              role: "user",
              text: "Continue",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: NOW,
          },
          readModel: makeReadModel(pending),
        }),
      );
      expectReminderBesideUnsnooze(events);
      expect(events.at(-1)?.type).toBe("thread.turn-start-requested");
    }),
  );

  it.effect("waking without a pending note appends no activity", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.unsnooze",
            commandId: CommandId.make("cmd-unsnooze-plain"),
            threadId: ThreadId.make("thread-1"),
            reason: "user",
          },
          readModel: makeReadModel({ snoozedUntil: FUTURE_WAKE }),
        }),
      );
      expect(events.map((event) => event.type)).toEqual(["thread.unsnoozed"]);
    }),
  );

  const deliver = (readModel: OrchestrationReadModel) =>
    decideOrchestrationCommand({
      command: {
        type: "thread.snooze-reminder.deliver",
        commandId: CommandId.make("cmd-deliver"),
        threadId: ThreadId.make("thread-1"),
      },
      readModel,
    });

  it.effect("deliver does nothing without a pending note", () =>
    Effect.gen(function* () {
      const events = asEvents(yield* deliver(makeReadModel({ snoozedUntil: PAST_WAKE })));
      expect(events).toEqual([]);
    }),
  );

  it.effect("deliver does nothing before the wake time", () =>
    Effect.gen(function* () {
      const events = asEvents(yield* deliver(makeReadModel(pending)));
      expect(events).toEqual([]);
    }),
  );

  it.effect("deliver appends the note and marks it delivered once due", () =>
    Effect.gen(function* () {
      const events = asEvents(
        yield* deliver(makeReadModel({ snoozedUntil: PAST_WAKE, snoozeReminder: REMINDER })),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.activity-appended",
        "thread.snooze-reminder-delivered",
      ]);
      const [activity] = reminderActivities(events);
      expect(activity?.summary).toBe(REMINDER);
      expect(activity?.turnId).toBeNull();
      expect(activity?.payload).toEqual({
        reminder: REMINDER,
        snoozedAt: SNOOZED_AT,
        snoozedUntil: PAST_WAKE,
      });
      const delivered = events[1];
      if (delivered?.type === "thread.snooze-reminder-delivered") {
        expect(delivered.payload.threadId).toBe("thread-1");
        expect(delivered.payload.updatedAt).toBe(activity?.createdAt);
      }
    }),
  );

  it.effect("deliver on an archived thread is rejected", () =>
    Effect.gen(function* () {
      const error = yield* deliver(
        makeReadModel({ snoozedUntil: PAST_WAKE, snoozeReminder: REMINDER, archivedAt: NOW }),
      ).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
