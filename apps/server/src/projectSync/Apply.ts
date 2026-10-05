/**
 * Writes sync batches into orchestration v2.
 *
 * Imported conversations become v2 threads with `historyOrigin: "v1_import"`
 * and run-less turn items, the same shape upstream's legacy importer gives a
 * pre-v2 thread. That reuse is deliberate: the orchestrator already hands a
 * v1-import thread's history to the provider on its first run, which is what a
 * continued conversation needs, and synced threads never run at all
 * (`rejectSyncedThreadRun`).
 *
 * Project changes go through `ProjectService` like any client command. Thread
 * changes and the batch record land in one transaction.
 */
import {
  CommandId,
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type ProjectId,
  isSyncedThreadId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ProjectService } from "../project/ProjectService.ts";
import type { SyncPlan, SyncStep } from "./Planner.ts";
import { insertSyncRecord } from "./Records.ts";
import { contentHash, type SyncThread } from "./Source.ts";

/** Commands and events the sync writes carry this prefix, so local edits can be told apart. */
export const SYNC_COMMAND_PREFIX = "fork-sync:";

const dateTime = (value: string) => DateTime.makeUnsafe(value);

function importedThread(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: SyncThread["modelSelection"];
  readonly runtimeMode: SyncThread["runtimeMode"];
  readonly interactionMode: SyncThread["interactionMode"];
  readonly branch: string | null;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
}): OrchestrationV2AppThread {
  return {
    createdBy: "system",
    creationSource: "server",
    id: input.threadId,
    projectId: input.projectId,
    title: input.title.trim() === "" ? "Untitled thread" : input.title,
    providerInstanceId: input.modelSelection.instanceId,
    modelSelection: input.modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    branch: input.branch,
    worktreePath: null,
    linkedPullRequest: null,
    pullRequests: [],
    branchPullRequest: null,
    activeOrderKey: null,
    activeProviderThreadId: null,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
    forkedFrom: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    autoSettleDisabledAt: null,
    pinOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const turnItemBase = (input: {
  readonly id: TurnItemId;
  readonly threadId: ThreadId;
  readonly status: OrchestrationV2TurnItem["status"];
  readonly title: string | null;
  readonly at: DateTime.Utc;
}) => ({
  id: input.id,
  threadId: input.threadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: input.status,
  title: input.title,
  startedAt: input.at,
  completedAt: input.at,
  updatedAt: input.at,
});

/** Events that create one imported conversation version with its full history. */
export function importThreadEvents(
  threadId: ThreadId,
  projectId: ProjectId,
  thread: SyncThread,
): OrchestrationV2DomainEvent[] {
  const app = importedThread({
    threadId,
    projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    createdAt: dateTime(thread.createdAt),
    updatedAt: dateTime(thread.updatedAt),
  });
  const id = (suffix: string) => EventId.make(`${SYNC_COMMAND_PREFIX}${threadId}:${suffix}`);
  // Positions are allocated in write order, so history goes in chronologically.
  const history = [
    ...thread.messages.map((message) => ({ kind: "message" as const, message })),
    ...thread.activities.map((activity) => ({ kind: "activity" as const, activity })),
  ].sort((a, b) =>
    (a.kind === "message" ? a.message.createdAt : a.activity.createdAt).localeCompare(
      b.kind === "message" ? b.message.createdAt : b.activity.createdAt,
    ),
  );
  const events: OrchestrationV2DomainEvent[] = [
    {
      id: id("created"),
      type: "thread.created",
      threadId,
      providerInstanceId: app.providerInstanceId,
      occurredAt: app.createdAt,
      payload: app,
    },
  ];
  for (const entry of history) {
    if (entry.kind === "activity") {
      const { activity } = entry;
      const itemId = TurnItemId.make(`${threadId}-${contentHash(activity.id).slice(0, 16)}`);
      const at = dateTime(activity.createdAt);
      events.push({
        id: id(`activity:${itemId}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload: {
          ...turnItemBase({
            id: itemId,
            threadId,
            status: activity.tone === "error" ? "failed" : "completed",
            title: activity.summary,
            at,
          }),
          type: "dynamic_tool",
          toolName: activity.kind.trim() === "" ? null : activity.kind,
          input: activity.details,
        },
      });
      continue;
    }
    const { message } = entry;
    const messageId = MessageId.make(`${threadId}-${contentHash(message.id).slice(0, 16)}`);
    const at = dateTime(message.createdAt);
    const itemId = TurnItemId.make(`${SYNC_COMMAND_PREFIX}turn-item:${messageId}`);
    events.push(
      {
        id: id(`message:${messageId}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          createdBy: message.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId: null,
          nodeId: null,
          role: message.role,
          text: message.text,
          attachments: message.attachments,
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      },
      {
        id: id(`turn-item:${messageId}`),
        type: "turn-item.updated",
        threadId,
        occurredAt: at,
        payload:
          message.role === "user"
            ? {
                ...turnItemBase({ id: itemId, threadId, status: "completed", title: null, at }),
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text: message.text,
                attachments: message.attachments,
              }
            : {
                ...turnItemBase({ id: itemId, threadId, status: "completed", title: null, at }),
                type: "assistant_message",
                messageId,
                text: message.text,
                streaming: false,
              },
      },
    );
  }
  // Each history event moved the thread's activity time; put the source's back.
  events.push({
    id: id("shell"),
    type: "thread.metadata-updated",
    threadId,
    providerInstanceId: app.providerInstanceId,
    occurredAt: app.updatedAt,
    payload: app,
  });
  return events;
}

type ManagementStep = Exclude<
  SyncStep,
  { readonly type: "project.create" | "project.update" | "project.delete" | "thread.import" }
>;

/** The thread after one organization step, mirroring the orchestrator's own transitions. */
export function manageThread(
  thread: OrchestrationV2AppThread,
  step: ManagementStep,
  now: DateTime.Utc,
): {
  readonly type: OrchestrationV2DomainEvent["type"];
  readonly thread: OrchestrationV2AppThread;
} {
  switch (step.type) {
    case "thread.visibility":
      return step.visible
        ? { type: "thread.metadata-updated", thread: { ...thread, deletedAt: null } }
        : { type: "thread.deleted", thread: { ...thread, deletedAt: now } };
    case "thread.archive":
      return {
        type: "thread.archived",
        thread: { ...thread, archivedAt: now, titleRegeneration: null, updatedAt: now },
      };
    case "thread.unarchive":
      return { type: "thread.unarchived", thread: { ...thread, archivedAt: null, updatedAt: now } };
    case "thread.settle":
      return {
        type: "thread.settled",
        thread: {
          ...thread,
          settledOverride: "settled",
          settledAt: now,
          unsettledAt: null,
          pinnedAt: null,
          pinOrderKey: null,
          activeOrderKey: null,
          updatedAt: now,
        },
      };
    case "thread.unsettle":
      return {
        type: "thread.unsettled",
        thread: {
          ...thread,
          settledOverride: "active",
          settledAt: null,
          unsettledAt: now,
          updatedAt: now,
        },
      };
  }
}

export const applySyncPlan = Effect.fn("ProjectSync.apply")(function* (plan: SyncPlan) {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectService;
  const eventSink = yield* EventSink.EventSinkV2;
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const now = yield* DateTime.now;
  const batch = `${SYNC_COMMAND_PREFIX}${plan.record.id}`;
  const commandId = (index: number, suffix = "") => CommandId.make(`${batch}:${index}${suffix}`);

  for (const [index, step] of plan.steps.entries()) {
    if (step.type === "project.create") {
      const { project } = step;
      yield* projects.create({
        commandId: commandId(index),
        projectId: step.projectId,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        defaultModelSelection: project.defaultModelSelection,
        scripts: project.scripts,
      });
      yield* projects.update({
        commandId: commandId(index, ":settings"),
        projectId: step.projectId,
        defaultThreadEnvMode: project.defaultThreadEnvMode ?? null,
        autoPull: project.autoPull ?? false,
        projectIcon: project.projectIcon ?? null,
      });
    } else if (step.type === "project.update") {
      yield* projects.update({
        commandId: commandId(index),
        projectId: step.projectId,
        ...step.settings,
      });
    }
  }

  const threads = new Map<ThreadId, OrchestrationV2AppThread>();
  const events: OrchestrationV2DomainEvent[] = [];
  for (const [index, step] of plan.steps.entries()) {
    if (step.type.startsWith("project.")) continue;
    if (step.type === "thread.import") {
      const created = importThreadEvents(step.threadId, step.projectId, step.thread);
      events.push(...created);
      const shell = created.at(-1);
      if (shell?.type === "thread.metadata-updated") threads.set(step.threadId, shell.payload);
      continue;
    }
    const managed = step as ManagementStep;
    const current = threads.get(managed.threadId) ?? (yield* store.getThread(managed.threadId));
    const next = manageThread(current, managed, now);
    threads.set(managed.threadId, next.thread);
    events.push({
      id: EventId.make(`${batch}:${index}`),
      type: next.type,
      threadId: managed.threadId,
      providerInstanceId: next.thread.providerInstanceId,
      occurredAt: now,
      payload: next.thread,
    } as OrchestrationV2DomainEvent);
  }

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (events.length > 0) yield* eventSink.write({ commandId: CommandId.make(batch), events });
      yield* insertSyncRecord(plan.record);
    }),
  );

  for (const [index, step] of plan.steps.entries()) {
    if (step.type === "project.delete") {
      yield* projects.delete({ commandId: commandId(index), projectId: step.projectId });
    }
  }
});

/**
 * Copies an imported conversation into a new thread that can run agents. Its
 * history stays run-less, so the first run hands it to the provider.
 */
export const continueSyncedThread = Effect.fn("ProjectSync.continue")(function* (
  sourceThreadId: ThreadId,
  threadId: ThreadId,
) {
  const eventSink = yield* EventSink.EventSinkV2;
  const store = yield* ProjectionStore.ProjectionStoreV2;
  if (!isSyncedThreadId(sourceThreadId)) {
    return yield* Effect.fail("Choose an imported conversation to continue.");
  }
  const source = yield* store.getThreadRecords(sourceThreadId, ["messages", "turnItems"]);
  if (source.thread.deletedAt !== null) {
    return yield* Effect.fail(
      "This imported conversation is no longer visible. Open its current version.",
    );
  }
  const now = yield* DateTime.now;
  const app = importedThread({
    ...source.thread,
    threadId,
    createdAt: now,
    updatedAt: now,
  });
  const id = (suffix: string) => EventId.make(`${SYNC_COMMAND_PREFIX}${threadId}:${suffix}`);
  const messageIds = new Map(
    source.messages.map(
      (message, index) => [message.id, MessageId.make(`${threadId}-${index}`)] as const,
    ),
  );
  const events: OrchestrationV2DomainEvent[] = [
    {
      id: id("created"),
      type: "thread.created",
      threadId,
      providerInstanceId: app.providerInstanceId,
      occurredAt: now,
      payload: app,
    },
  ];
  for (const message of source.messages) {
    const messageId = messageIds.get(message.id)!;
    events.push({
      id: id(`message:${messageId}`),
      type: "message.updated",
      threadId,
      occurredAt: message.createdAt,
      payload: { ...message, id: messageId, threadId },
    });
  }
  const items = [...source.turnItems].sort((a, b) => a.ordinal - b.ordinal);
  for (const [index, item] of items.entries()) {
    const itemId = TurnItemId.make(`${threadId}-item-${index}`);
    const messageId =
      "messageId" in item && item.messageId !== undefined ? messageIds.get(item.messageId) : null;
    events.push({
      id: id(`turn-item:${itemId}`),
      type: "turn-item.updated",
      threadId,
      occurredAt: item.updatedAt,
      payload: {
        ...item,
        id: itemId,
        threadId,
        ...(messageId ? { messageId } : {}),
      } as OrchestrationV2TurnItem,
    });
  }
  events.push({
    id: id("shell"),
    type: "thread.metadata-updated",
    threadId,
    providerInstanceId: app.providerInstanceId,
    occurredAt: now,
    payload: app,
  });
  yield* eventSink.write({
    commandId: CommandId.make(`${SYNC_COMMAND_PREFIX}${threadId}`),
    events,
  });
  return threadId;
});
