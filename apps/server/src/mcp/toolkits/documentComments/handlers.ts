import { CommandId, type ThreadDocumentComment, type ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  type DocumentCommentEntry,
  DocumentCommentListFailedError,
  DocumentCommentNotFoundError,
  DocumentCommentResolveFailedError,
  DocumentCommentThreadNotFoundError,
  DocumentCommentsToolkit,
} from "./tools.ts";

function entryOf(comment: ThreadDocumentComment): DocumentCommentEntry {
  return {
    id: comment.id,
    filePath: comment.filePath,
    startLine: comment.anchor.startLine,
    endLine: comment.anchor.endLine,
    quote: comment.anchor.text,
    body: comment.body,
    status: comment.status,
    resolution: comment.resolution,
  };
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const commandId = (tag: string, threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`server:${tag}:${threadId}:${uuid}`)),
    );

  const threadComments = Effect.fn("DocumentCommentsToolkit.threadComments")(function* (
    Failure: typeof DocumentCommentListFailedError | typeof DocumentCommentResolveFailedError,
  ) {
    const scope = yield* McpInvocationContext.requireMcpCapability("document-comments");
    const thread = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    if (Option.isNone(thread)) {
      return yield* new DocumentCommentThreadNotFoundError({ threadId: scope.threadId });
    }
    const comments = yield* snapshots
      .listThreadDocumentComments(scope.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    return { threadId: scope.threadId, comments };
  });

  return DocumentCommentsToolkit.of({
    list_document_comments: (input) =>
      threadComments(DocumentCommentListFailedError).pipe(
        Effect.map(({ comments }) => ({
          comments: comments
            .filter(
              (comment) =>
                (input.filePath === undefined || comment.filePath === input.filePath) &&
                (input.status === undefined || comment.status === input.status),
            )
            .map(entryOf),
        })),
      ),
    resolve_document_comment: (input) =>
      Effect.gen(function* () {
        const { threadId, comments } = yield* threadComments(DocumentCommentResolveFailedError);
        const comment = comments.find((candidate) => candidate.id === input.commentId);
        if (comment === undefined) {
          return yield* new DocumentCommentNotFoundError({ commentId: input.commentId });
        }
        // Re-resolving still dispatches: the decider re-emits and the projection
        // keeps the first note, so the tool stays idempotent.
        const deletedMeanwhile = yield* engine
          .dispatch({
            type: "thread.document-comment.resolve",
            commandId: yield* commandId("mcp-document-comment-resolve", threadId),
            threadId,
            commentId: comment.id,
            resolution: input.resolution ?? null,
          })
          .pipe(
            Effect.as(false),
            // The decider only rejects an unknown id: the user deleted it meanwhile.
            Effect.catchTags({ OrchestrationCommandInvariantError: () => Effect.succeed(true) }),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause as Cause.Cause<never>)
                : Effect.fail(new DocumentCommentResolveFailedError({ cause })),
            ),
          );
        if (deletedMeanwhile) {
          return yield* new DocumentCommentNotFoundError({ commentId: comment.id });
        }
        return {
          commentId: comment.id,
          resolved: true as const,
          alreadyResolved: comment.status === "resolved",
        };
      }),
  });
});

export const DocumentCommentsToolkitHandlersLive = DocumentCommentsToolkit.toLayer(make);
