/**
 * Fork-only document comments: a user's margin notes on rendered workspace files,
 * kept per thread and never written into the files.
 *
 * Comments live outside the orchestration event log, in the
 * `projection_thread_document_comments` table the v1 fork already used, so fork
 * databases carry them into v2 untouched. Each change publishes the thread's
 * whole list; clients and the MCP tools read the same service.
 */
import {
  type ThreadDocumentComment,
  type ThreadDocumentCommentMutateInput,
  type ThreadDocumentComments,
  ThreadDocumentCommentsError,
  type ThreadId,
} from "@t3tools/contracts";
import { applyThreadDocumentCommentEvent } from "@t3tools/shared/threadDocumentComments";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as CommentRepository from "../persistence/ProjectionThreadDocumentComments.ts";

export class DocumentComments extends Context.Service<
  DocumentComments,
  {
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ThreadDocumentComment>, ThreadDocumentCommentsError>;
    readonly mutate: (
      input: ThreadDocumentCommentMutateInput,
    ) => Effect.Effect<ThreadDocumentComments, ThreadDocumentCommentsError>;
    /** The thread's comments now, then again after every change. */
    readonly stream: (
      threadId: ThreadId,
    ) => Stream.Stream<ThreadDocumentComments, ThreadDocumentCommentsError>;
  }
>()("t3/fork/DocumentComments") {}

const failure = (message: string) => new ThreadDocumentCommentsError({ message });

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const repository = yield* CommentRepository.ProjectionThreadDocumentCommentRepository;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const changes = yield* PubSub.unbounded<ThreadDocumentComments>();
  // Comments change by hand, a few at a time; one lock keeps check-then-write atomic.
  const lock = yield* Semaphore.make(1);

  const list: DocumentComments["Service"]["list"] = (threadId) =>
    repository.listByThreadId({ threadId }).pipe(
      Effect.map((rows) => rows.map(({ threadId: _threadId, ...comment }) => comment)),
      Effect.mapError(() => failure("Could not read document comments.")),
    );

  const requireThread = (threadId: ThreadId) =>
    orchestrator.getThreadShell(threadId).pipe(
      Effect.mapError(() => failure("Could not read the thread.")),
      Effect.flatMap((shell) =>
        shell === null || shell.deletedAt !== null
          ? Effect.fail(failure(`Thread ${threadId} does not exist.`))
          : Effect.void,
      ),
    );

  const mutate: DocumentComments["Service"]["mutate"] = ({ threadId, mutation }) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        yield* requireThread(threadId);
        const before = yield* list(threadId);
        const existing = before.find((comment) => comment.id === mutation.commentId);
        if (mutation.type === "add" && existing !== undefined) {
          return yield* failure(
            `Document comment ${mutation.commentId} already exists on thread ${threadId}.`,
          );
        }
        if (mutation.type !== "add" && existing === undefined) {
          return yield* failure(
            `Document comment ${mutation.commentId} does not exist on thread ${threadId}.`,
          );
        }
        const now = DateTime.formatIso(yield* DateTime.now);
        const key = { threadId, commentId: mutation.commentId };
        const after = applyThreadDocumentCommentEvent(
          before,
          mutation.type === "add"
            ? {
                type: "thread.document-comment-added",
                payload: {
                  threadId,
                  comment: {
                    id: mutation.commentId,
                    filePath: mutation.filePath,
                    anchor: mutation.anchor,
                    body: mutation.body,
                    status: "open",
                    resolution: null,
                    createdAt: now,
                    updatedAt: now,
                    resolvedAt: null,
                  },
                },
              }
            : mutation.type === "update"
              ? {
                  type: "thread.document-comment-updated",
                  payload: { ...key, body: mutation.body, updatedAt: now },
                }
              : mutation.type === "delete"
                ? { type: "thread.document-comment-deleted", payload: { ...key, deletedAt: now } }
                : mutation.type === "resolve"
                  ? {
                      type: "thread.document-comment-resolved",
                      payload: { ...key, resolution: mutation.resolution, resolvedAt: now },
                    }
                  : {
                      type: "thread.document-comment-reopened",
                      payload: { ...key, reopenedAt: now },
                    },
        );
        const write =
          mutation.type === "delete"
            ? repository.delete(key)
            : Effect.forEach(
                after.filter((comment) => comment.id === mutation.commentId),
                (comment) => repository.upsert({ threadId, ...comment }),
                { discard: true },
              );
        yield* write.pipe(Effect.mapError(() => failure("Could not save the document comment.")));
        const result: ThreadDocumentComments = { threadId, comments: after };
        yield* PubSub.publish(changes, result);
        return result;
      }),
    );

  const stream: DocumentComments["Service"]["stream"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before the first read so a change in between is not lost.
        const subscription = yield* PubSub.subscribe(changes);
        const current = yield* list(threadId);
        return Stream.concat(
          Stream.succeed<ThreadDocumentComments>({ threadId, comments: current }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((change) => change.threadId === threadId),
          ),
        );
      }),
    );

  return DocumentComments.of({ list, mutate, stream });
});

export const layer = Layer.effect(DocumentComments, make).pipe(
  Layer.provide(CommentRepository.layer),
);
