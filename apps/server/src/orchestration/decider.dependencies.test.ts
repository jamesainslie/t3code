import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationSession,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ThreadDependency,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// The decider's clock is the Effect test clock, pinned to the epoch.
const LINKED_AT = "1969-12-30T00:00:00.000Z";
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";

const A = ThreadId.make("thread-a");
const B = ThreadId.make("thread-b");
const C = ThreadId.make("thread-c");

type ThreadOverrides = Partial<OrchestrationThread> & { readonly id: ThreadId };

function makeThread(overrides: ThreadOverrides): OrchestrationThread {
  return {
    projectId: ProjectId.make("project-1"),
    title: `Thread ${overrides.id}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    dependencies: [],
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeReadModel(threads: ReadonlyArray<ThreadOverrides>): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: threads.map(makeThread),
    updatedAt: NOW,
  };
}

function link(threadId: ThreadId, satisfiedAt: string | null = null): ThreadDependency {
  return { threadId, linkedAt: LINKED_AT, satisfiedAt, satisfiedReason: null };
}

type DecidedEvents = Effect.Success<ReturnType<typeof decideOrchestrationCommand>>;
type DecidedEvent = Exclude<DecidedEvents, ReadonlyArray<unknown>>;

function asArray(value: DecidedEvents): ReadonlyArray<DecidedEvent> {
  return Array.isArray(value) ? value : [value as DecidedEvent];
}

// Planned events are Omit<OrchestrationEvent, "sequence">, which is not a
// discriminated union, so assert the type and hand back the matching payload.
type PayloadByType = { [E in OrchestrationEvent as E["type"]]: E["payload"] };

function payloadOf<T extends OrchestrationEvent["type"]>(
  event: DecidedEvent | undefined,
  type: T,
): PayloadByType[T] {
  expect(event?.type).toBe(type);
  return event!.payload as PayloadByType[T];
}

const addCommand = (threadId: ThreadId, dependsOnThreadId: ThreadId) =>
  ({
    type: "thread.dependency.add",
    commandId: CommandId.make(`cmd-add-${threadId}-${dependsOnThreadId}`),
    threadId,
    dependsOnThreadId,
  }) as const;

it.layer(NodeServices.layer)("thread dependency decider", (it) => {
  it.effect("links a thread to another thread", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: addCommand(A, B),
          readModel: makeReadModel([{ id: A }, { id: B }]),
        }),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.aggregateId).toBe(A);
      const payload = payloadOf(events[0], "thread.dependency-added");
      expect(payload.dependsOnThreadId).toBe(B);
      expect(payload.linkedAt).toBe(payload.updatedAt);
    }),
  );

  it.effect("rejects a thread depending on itself", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: addCommand(A, A),
        readModel: makeReadModel([{ id: A }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects an unknown dependency", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: addCommand(A, B),
        readModel: makeReadModel([{ id: A }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects an archived dependency", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: addCommand(A, B),
        readModel: makeReadModel([{ id: A }, { id: B, archivedAt: NOW }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a synced dependency", () =>
    Effect.gen(function* () {
      const synced = ThreadId.make("t3sync-thread");
      const error = yield* decideOrchestrationCommand({
        command: addCommand(A, synced),
        readModel: makeReadModel([{ id: A }, { id: synced }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a link that would form a cycle through open links", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: addCommand(A, B),
        readModel: makeReadModel([
          { id: A },
          { id: B, dependencies: [link(C)] },
          { id: C, dependencies: [link(A)] },
        ]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("allows a link whose reverse path is already satisfied", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: addCommand(A, B),
          readModel: makeReadModel([{ id: A }, { id: B, dependencies: [link(A, NOW)] }]),
        }),
      );
      expect(events[0]?.type).toBe("thread.dependency-added");
    }),
  );

  it.effect("rejects parking blocked-on-you work", () =>
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
        command: addCommand(A, B),
        readModel: makeReadModel([{ id: A, activities: [requestActivity] }, { id: B }]),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("re-adding an open link re-emits with the original linkedAt", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: addCommand(A, B),
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events).toHaveLength(1);
      const payload = payloadOf(events[0], "thread.dependency-added");
      expect(payload.linkedAt).toBe(LINKED_AT);
      expect(payload.updatedAt).toBe(NOW);
    }),
  );

  it.effect("re-adding a satisfied link starts a fresh wait", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: addCommand(A, B),
          readModel: makeReadModel([{ id: A, dependencies: [link(B, NOW)] }, { id: B }]),
        }),
      );
      const payload = payloadOf(events[0], "thread.dependency-added");
      expect(payload.linkedAt).not.toBe(LINKED_AT);
      expect(payload.linkedAt).toBe(payload.updatedAt);
    }),
  );

  it.effect("adding a link clears an active snooze first", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: addCommand(A, B),
          readModel: makeReadModel([
            { id: A, snoozedUntil: FUTURE_WAKE, snoozedAt: LINKED_AT },
            { id: B },
          ]),
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.unsnoozed",
        "thread.dependency-added",
      ]);
      expect(events.at(-1)?.aggregateId).toBe(A);
    }),
  );

  it.effect("removing links is idempotent and only bumps updatedAt when a link goes", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]);
      const removed = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.dependency.remove",
            commandId: CommandId.make("cmd-remove-1"),
            threadId: A,
            dependsOnThreadIds: [B, C],
          },
          readModel,
        }),
      );
      expect(payloadOf(removed[0], "thread.dependencies-removed").updatedAt).not.toBe(NOW);
      const noop = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.dependency.remove",
            commandId: CommandId.make("cmd-remove-2"),
            threadId: A,
            dependsOnThreadIds: [C],
          },
          readModel,
        }),
      );
      expect(payloadOf(noop[0], "thread.dependencies-removed").updatedAt).toBe(NOW);
    }),
  );
});

const approvalActivity = {
  id: EventId.make("activity-approval-1"),
  tone: "approval" as const,
  kind: "approval.requested",
  summary: "approval.requested",
  payload: { requestId: "req-1" },
  turnId: null,
  createdAt: NOW,
} as OrchestrationThread["activities"][number];

const runningTurn: OrchestrationThread["latestTurn"] = {
  turnId: TurnId.make("turn-1"),
  state: "running",
  requestedAt: NOW,
  startedAt: NOW,
  completedAt: null,
  assistantMessageId: null,
};

function session(threadId: ThreadId, status: OrchestrationSession["status"]): OrchestrationSession {
  return {
    threadId,
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: status === "running" ? TurnId.make("turn-1") : null,
    lastError: null,
    updatedAt: NOW,
  };
}

const sessionSetCommand = (threadId: ThreadId, status: OrchestrationSession["status"]) =>
  ({
    type: "thread.session.set",
    commandId: CommandId.make(`cmd-session-${threadId}-${status}`),
    threadId,
    session: session(threadId, status),
    createdAt: NOW,
  }) as const;

it.layer(NodeServices.layer)("thread dependency satisfaction", (it) => {
  it.effect("a dependency finishing its turn satisfies every open link, own event last", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: sessionSetCommand(B, "ready"),
          readModel: makeReadModel([
            { id: A, dependencies: [link(B)] },
            { id: B, latestTurn: runningTurn, session: session(B, "running") },
            { id: C, dependencies: [link(B)] },
            { id: ThreadId.make("thread-d"), dependencies: [link(B, NOW)] },
          ]),
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.dependency-satisfied",
        "thread.dependency-satisfied",
        "thread.session-set",
      ]);
      expect(events.map((event) => event.aggregateId)).toEqual([A, C, B]);
      expect(payloadOf(events[0], "thread.dependency-satisfied").reason).toBe("turn-finished");
    }),
  );

  it.effect("a fresh session error satisfies with session-error, a repeated one does not", () =>
    Effect.gen(function* () {
      const fresh = asArray(
        yield* decideOrchestrationCommand({
          command: sessionSetCommand(B, "error"),
          readModel: makeReadModel([
            { id: A, dependencies: [link(B)] },
            { id: B, session: session(B, "ready") },
          ]),
        }),
      );
      expect(payloadOf(fresh[0], "thread.dependency-satisfied").reason).toBe("session-error");
      const repeated = asArray(
        yield* decideOrchestrationCommand({
          command: sessionSetCommand(B, "error"),
          readModel: makeReadModel([
            { id: A, dependencies: [link(B)] },
            { id: B, session: session(B, "error") },
          ]),
        }),
      );
      expect(repeated.map((event) => event.type)).toEqual(["thread.session-set"]);
    }),
  );

  it.effect("a status write with no turn ending emits nothing extra", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: sessionSetCommand(B, "ready"),
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events.map((event) => event.type)).toEqual(["thread.session-set"]);
    }),
  );

  it.effect("a request opening on the dependency satisfies with request-opened", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.activity.append",
            commandId: CommandId.make("cmd-activity-approval"),
            threadId: B,
            activity: approvalActivity,
            createdAt: NOW,
          },
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.dependency-satisfied",
        "thread.activity-appended",
      ]);
      expect(payloadOf(events[0], "thread.dependency-satisfied").reason).toBe("request-opened");
    }),
  );

  it.effect("archiving or deleting the dependency satisfies", () =>
    Effect.gen(function* () {
      const readModel = makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]);
      const archived = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.archive",
            commandId: CommandId.make("cmd-archive"),
            threadId: B,
          },
          readModel,
        }),
      );
      expect(archived.map((event) => event.type)).toEqual([
        "thread.dependency-satisfied",
        "thread.archived",
      ]);
      expect(payloadOf(archived[0], "thread.dependency-satisfied").reason).toBe("archived");
      const deleted = asArray(
        yield* decideOrchestrationCommand({
          command: { type: "thread.delete", commandId: CommandId.make("cmd-delete"), threadId: B },
          readModel,
        }),
      );
      expect(deleted.map((event) => event.type)).toEqual([
        "thread.dependency-satisfied",
        "thread.deleted",
      ]);
      expect(payloadOf(deleted[0], "thread.dependency-satisfied").reason).toBe("deleted");
    }),
  );

  it.effect("starting a turn on a blocked thread clears its links", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-turn-start"),
            threadId: A,
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
          readModel: makeReadModel([{ id: A, dependencies: [link(B), link(C, NOW)] }, { id: B }]),
        }),
      );
      const removed = events.find((event) => event.type === "thread.dependencies-removed");
      expect(payloadOf(removed, "thread.dependencies-removed").dependsOnThreadIds).toEqual([B, C]);
    }),
  );

  it.effect("snoozing a blocked thread clears its links first", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: {
            type: "thread.snooze",
            commandId: CommandId.make("cmd-snooze"),
            threadId: A,
            snoozedUntil: FUTURE_WAKE,
          },
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events.map((event) => event.type)).toEqual([
        "thread.dependencies-removed",
        "thread.snoozed",
      ]);
    }),
  );

  it.effect("settling a blocked thread clears its links", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: { type: "thread.settle", commandId: CommandId.make("cmd-settle"), threadId: A },
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events.map((event) => event.type)).toContain("thread.dependencies-removed");
    }),
  );

  it.effect("pinning a blocked thread clears its links", () =>
    Effect.gen(function* () {
      const events = asArray(
        yield* decideOrchestrationCommand({
          command: { type: "thread.pin", commandId: CommandId.make("cmd-pin"), threadId: A },
          readModel: makeReadModel([{ id: A, dependencies: [link(B)] }, { id: B }]),
        }),
      );
      expect(events.map((event) => event.type)).toContain("thread.dependencies-removed");
    }),
  );
});
