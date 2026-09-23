import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type ThreadDocumentComment,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");

function makeEvent(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: THREAD_ID,
    occurredAt: LATER,
    commandId: CommandId.make(`command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

const comment: ThreadDocumentComment = {
  id: "comment-1",
  filePath: "docs/plan.md",
  anchor: {
    text: "passage",
    start: 0,
    end: 7,
    prefix: "",
    suffix: "",
    startLine: 2,
    endLine: 2,
  },
  body: "Tighten this.",
  status: "open",
  resolution: null,
  createdAt: NOW,
  updatedAt: NOW,
  resolvedAt: null,
};

const createThread = (model: OrchestrationReadModel) =>
  projectEvent(
    model,
    makeEvent({
      sequence: model.snapshotSequence + 1,
      type: "thread.created",
      payload: {
        threadId: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { provider: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  );

it.effect("projects document comment events onto the thread without touching updatedAt", () =>
  Effect.gen(function* () {
    const created = yield* createThread(createEmptyReadModel(NOW));
    expect(created.threads[0]?.documentComments).toEqual([]);

    const added = yield* projectEvent(
      created,
      makeEvent({
        sequence: 2,
        type: "thread.document-comment-added",
        payload: { threadId: THREAD_ID, comment },
      }),
    );
    expect(added.threads[0]?.documentComments).toEqual([comment]);
    expect(added.threads[0]?.updatedAt).toBe(NOW);

    const resolved = yield* projectEvent(
      added,
      makeEvent({
        sequence: 3,
        type: "thread.document-comment-resolved",
        payload: {
          threadId: THREAD_ID,
          commentId: "comment-1",
          resolution: "Split it.",
          resolvedAt: LATER,
        },
      }),
    );
    expect(resolved.threads[0]?.documentComments).toEqual([
      {
        ...comment,
        status: "resolved",
        resolution: "Split it.",
        resolvedAt: LATER,
        updatedAt: LATER,
      },
    ]);

    const reopened = yield* projectEvent(
      resolved,
      makeEvent({
        sequence: 4,
        type: "thread.document-comment-reopened",
        payload: { threadId: THREAD_ID, commentId: "comment-1", reopenedAt: LATER },
      }),
    );
    expect(reopened.threads[0]?.documentComments).toEqual([{ ...comment, updatedAt: LATER }]);

    const updated = yield* projectEvent(
      reopened,
      makeEvent({
        sequence: 5,
        type: "thread.document-comment-updated",
        payload: {
          threadId: THREAD_ID,
          commentId: "comment-1",
          body: "Rewrite.",
          updatedAt: LATER,
        },
      }),
    );
    expect(updated.threads[0]?.documentComments?.[0]?.body).toBe("Rewrite.");

    const deleted = yield* projectEvent(
      updated,
      makeEvent({
        sequence: 6,
        type: "thread.document-comment-deleted",
        payload: { threadId: THREAD_ID, commentId: "comment-1", deletedAt: LATER },
      }),
    );
    expect(deleted.threads[0]?.documentComments).toEqual([]);
    expect(deleted.snapshotSequence).toBe(6);
  }),
);
