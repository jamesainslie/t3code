import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const createdAt = "2026-08-24T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const sourceThreadId = ThreadId.make("thread-source");

const eventBase = (sequence: number, aggregateKind: "project" | "thread", aggregateId: string) => ({
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  aggregateKind,
  aggregateId:
    aggregateKind === "project" ? ProjectId.make(aggregateId) : ThreadId.make(aggregateId),
  occurredAt: createdAt,
  commandId: CommandId.make(`command-${sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`command-${sequence}`),
  metadata: {},
});

const projectCreated = {
  ...eventBase(1, "project", projectId),
  type: "project.created",
  payload: {
    projectId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    defaultModelSelection: null,
    scripts: [],
    createdAt,
    updatedAt: createdAt,
  },
} as OrchestrationEvent;

const sourceCreated = {
  ...eventBase(2, "thread", sourceThreadId),
  type: "thread.created",
  payload: {
    threadId: sourceThreadId,
    projectId,
    title: "Source thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt,
    updatedAt: createdAt,
  },
} as OrchestrationEvent;

const sourceDeleted = {
  ...eventBase(3, "thread", sourceThreadId),
  type: "thread.deleted",
  payload: { threadId: sourceThreadId, deletedAt: createdAt },
} as OrchestrationEvent;

const readModelFrom = (events: ReadonlyArray<OrchestrationEvent>) =>
  Effect.reduce(
    events,
    () => createEmptyReadModel(createdAt),
    (model, event) => projectEvent(model, event),
  );

const makeCreateCommand = (threadId: ThreadId) => ({
  type: "thread.create" as const,
  commandId: CommandId.make(`command-create-${threadId}`),
  threadId,
  projectId,
  title: "Continued thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  createdAt,
});

it.layer(NodeServices.layer)("thread continuation", (it) => {
  it.effect("thread.create carries continuedFromThreadId into thread.created", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelFrom([projectCreated, sourceCreated]);
      const continued = yield* decideOrchestrationCommand({
        command: {
          ...makeCreateCommand(ThreadId.make("thread-next")),
          continuedFromThreadId: sourceThreadId,
        },
        readModel,
      });
      const fresh = yield* decideOrchestrationCommand({
        command: makeCreateCommand(ThreadId.make("thread-fresh")),
        readModel,
      });

      expect(continued).toMatchObject({
        type: "thread.created",
        payload: { threadId: "thread-next", continuedFromThreadId: sourceThreadId },
      });
      expect(fresh).toMatchObject({ type: "thread.created" });
      expect(fresh).not.toHaveProperty("payload.continuedFromThreadId");
    }),
  );

  it.effect("rejects continuing from a thread that does not exist", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelFrom([projectCreated]);
      const error = yield* decideOrchestrationCommand({
        command: {
          ...makeCreateCommand(ThreadId.make("thread-next")),
          continuedFromThreadId: ThreadId.make("thread-missing"),
        },
        readModel,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(OrchestrationCommandInvariantError);
      expect(error).toMatchObject({
        commandType: "thread.create",
        detail: expect.stringContaining("thread-missing"),
      });
    }),
  );

  it.effect("rejects continuing from a deleted thread", () =>
    Effect.gen(function* () {
      const readModel = yield* readModelFrom([projectCreated, sourceCreated, sourceDeleted]);
      const error = yield* decideOrchestrationCommand({
        command: {
          ...makeCreateCommand(ThreadId.make("thread-next")),
          continuedFromThreadId: sourceThreadId,
        },
        readModel,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(OrchestrationCommandInvariantError);
      expect(error).toMatchObject({
        commandType: "thread.create",
        detail: expect.stringContaining(sourceThreadId),
      });
    }),
  );
});
