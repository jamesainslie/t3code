import {
  CommandId,
  OrchestrationEvent,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type ThreadDocumentComment,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { isThreadDetailEvent } from "../ws.ts";
import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");
const encodeEvent = Schema.encodeEffect(OrchestrationEvent);
const decodeEvent = Schema.decodeUnknownEffect(OrchestrationEvent);

const anchor = {
  text: "the quoted passage",
  start: 10,
  end: 28,
  prefix: "before ",
  suffix: " after",
  startLine: 3,
  endLine: 4,
};

function makeComment(overrides: Partial<ThreadDocumentComment> = {}): ThreadDocumentComment {
  return {
    id: "comment-1",
    filePath: "docs/plan.md",
    anchor,
    body: "Tighten this section.",
    status: "open",
    resolution: null,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
    ...overrides,
  };
}

function makeReadModel(
  input: {
    readonly documentComments?: ReadonlyArray<ThreadDocumentComment>;
    readonly archivedAt?: string | null;
  } = {},
): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
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
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        documentComments: input.documentComments ?? [],
      },
    ],
    updatedAt: NOW,
  };
}

const decide = (command: OrchestrationCommand, readModel: OrchestrationReadModel) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.map((event) => (Array.isArray(event) ? event : [event])),
  );

const addCommand = {
  type: "thread.document-comment.add",
  commandId: CommandId.make("cmd-add"),
  threadId: THREAD_ID,
  commentId: "comment-1",
  filePath: "docs/plan.md",
  anchor,
  body: "Tighten this section.",
} as const;

it.layer(NodeServices.layer)("thread document comment decider", (it) => {
  it.effect("adds an open comment stamped with the same created and updated time", () =>
    Effect.gen(function* () {
      const events = yield* decide(addCommand, makeReadModel());
      expect(events).toHaveLength(1);
      const event = events[0];
      if (event?.type !== "thread.document-comment-added") {
        return expect.unreachable("expected thread.document-comment-added");
      }
      expect(event.aggregateId).toBe(THREAD_ID);
      expect(event.payload.threadId).toBe(THREAD_ID);
      expect(event.payload.comment).toMatchObject({
        id: "comment-1",
        filePath: "docs/plan.md",
        anchor,
        body: "Tighten this section.",
        status: "open",
        resolution: null,
        resolvedAt: null,
      });
      expect(event.payload.comment.createdAt).toBe(event.occurredAt);
      expect(event.payload.comment.updatedAt).toBe(event.occurredAt);
    }),
  );

  it.effect("routes every comment event to thread detail subscribers", () =>
    Effect.gen(function* () {
      const comment = makeComment();
      const base = { commandId: CommandId.make("cmd-route"), threadId: THREAD_ID };
      const commands: ReadonlyArray<[OrchestrationCommand, OrchestrationReadModel]> = [
        [addCommand, makeReadModel()],
        [
          { ...base, type: "thread.document-comment.update", commentId: comment.id, body: "B." },
          makeReadModel({ documentComments: [comment] }),
        ],
        [
          { ...base, type: "thread.document-comment.delete", commentId: comment.id },
          makeReadModel({ documentComments: [comment] }),
        ],
        [
          {
            ...base,
            type: "thread.document-comment.resolve",
            commentId: comment.id,
            resolution: null,
          },
          makeReadModel({ documentComments: [comment] }),
        ],
        [
          { ...base, type: "thread.document-comment.reopen", commentId: comment.id },
          makeReadModel({ documentComments: [comment] }),
        ],
      ];
      for (const [command, readModel] of commands) {
        for (const planned of yield* decide(command, readModel)) {
          const decoded = yield* decodeEvent(yield* encodeEvent({ ...planned, sequence: 1 }));
          expect(isThreadDetailEvent(decoded)).toBe(true);
        }
      }
    }),
  );

  it.effect("accepts comments on an archived thread", () =>
    Effect.gen(function* () {
      const events = yield* decide(addCommand, makeReadModel({ archivedAt: NOW }));
      expect(events.map((event) => event.type)).toEqual(["thread.document-comment-added"]);
    }),
  );

  it.effect("rejects a duplicate comment id", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        addCommand,
        makeReadModel({ documentComments: [makeComment()] }),
      ).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects a missing thread", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        { ...addCommand, threadId: ThreadId.make("thread-missing") },
        makeReadModel(),
      ).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("updates the body and stamps updatedAt", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "thread.document-comment.update",
          commandId: CommandId.make("cmd-update"),
          threadId: THREAD_ID,
          commentId: "comment-1",
          body: "Rewrite it instead.",
        },
        makeReadModel({ documentComments: [makeComment()] }),
      );
      const event = events[0];
      if (event?.type !== "thread.document-comment-updated") {
        return expect.unreachable("expected thread.document-comment-updated");
      }
      expect(event.payload).toEqual({
        threadId: THREAD_ID,
        commentId: "comment-1",
        body: "Rewrite it instead.",
        updatedAt: event.occurredAt,
      });
    }),
  );

  it.effect("deletes a comment", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "thread.document-comment.delete",
          commandId: CommandId.make("cmd-delete"),
          threadId: THREAD_ID,
          commentId: "comment-1",
        },
        makeReadModel({ documentComments: [makeComment()] }),
      );
      const event = events[0];
      if (event?.type !== "thread.document-comment-deleted") {
        return expect.unreachable("expected thread.document-comment-deleted");
      }
      expect(event.payload).toEqual({
        threadId: THREAD_ID,
        commentId: "comment-1",
        deletedAt: event.occurredAt,
      });
    }),
  );

  it.effect("resolves with the agent's note", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "thread.document-comment.resolve",
          commandId: CommandId.make("cmd-resolve"),
          threadId: THREAD_ID,
          commentId: "comment-1",
          resolution: "Split the section in two.",
        },
        makeReadModel({ documentComments: [makeComment()] }),
      );
      const event = events[0];
      if (event?.type !== "thread.document-comment-resolved") {
        return expect.unreachable("expected thread.document-comment-resolved");
      }
      expect(event.payload).toEqual({
        threadId: THREAD_ID,
        commentId: "comment-1",
        resolution: "Split the section in two.",
        resolvedAt: event.occurredAt,
      });
    }),
  );

  it.effect("re-emits resolve on an already resolved comment", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "thread.document-comment.resolve",
          commandId: CommandId.make("cmd-resolve-again"),
          threadId: THREAD_ID,
          commentId: "comment-1",
          resolution: null,
        },
        makeReadModel({
          documentComments: [
            makeComment({ status: "resolved", resolution: "Done.", resolvedAt: NOW }),
          ],
        }),
      );
      expect(events.map((event) => event.type)).toEqual(["thread.document-comment-resolved"]);
    }),
  );

  it.effect("reopens a comment, and re-emits reopen on an open one", () =>
    Effect.gen(function* () {
      const reopen = {
        type: "thread.document-comment.reopen",
        commandId: CommandId.make("cmd-reopen"),
        threadId: THREAD_ID,
        commentId: "comment-1",
      } as const;
      const events = yield* decide(
        reopen,
        makeReadModel({
          documentComments: [
            makeComment({ status: "resolved", resolution: "Done.", resolvedAt: NOW }),
          ],
        }),
      );
      const event = events[0];
      if (event?.type !== "thread.document-comment-reopened") {
        return expect.unreachable("expected thread.document-comment-reopened");
      }
      expect(event.payload).toEqual({
        threadId: THREAD_ID,
        commentId: "comment-1",
        reopenedAt: event.occurredAt,
      });

      const again = yield* decide(reopen, makeReadModel({ documentComments: [makeComment()] }));
      expect(again.map((entry) => entry.type)).toEqual(["thread.document-comment-reopened"]);
    }),
  );

  it.effect("rejects an unknown comment id for every follow-up command", () =>
    Effect.gen(function* () {
      const base = {
        commandId: CommandId.make("cmd-unknown"),
        threadId: THREAD_ID,
        commentId: "comment-missing",
      };
      const commands: ReadonlyArray<OrchestrationCommand> = [
        { ...base, type: "thread.document-comment.update", body: "Anything." },
        { ...base, type: "thread.document-comment.delete" },
        { ...base, type: "thread.document-comment.resolve", resolution: null },
        { ...base, type: "thread.document-comment.reopen" },
      ];
      for (const command of commands) {
        const error = yield* decide(
          command,
          makeReadModel({ documentComments: [makeComment()] }),
        ).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );
});
