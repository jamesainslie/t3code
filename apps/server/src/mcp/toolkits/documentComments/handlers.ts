import type { ThreadDocumentComment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as DocumentComments from "../../../fork/DocumentComments.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
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
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const documentComments = yield* DocumentComments.DocumentComments;

  const threadComments = Effect.fn("DocumentCommentsToolkit.threadComments")(function* (
    Failure: typeof DocumentCommentListFailedError | typeof DocumentCommentResolveFailedError,
  ) {
    const invocation = yield* McpInvocationContext.requireMcpCapability("document-comments");
    // Comments belong to the calling thread; a caller outside a thread has none.
    if (invocation.thread === undefined) {
      return yield* new Failure({
        cause: "Document comments are read from the calling T3 thread.",
      });
    }
    const scope = { threadId: invocation.thread.threadId };
    const thread = yield* orchestrator
      .getThreadShell(scope.threadId)
      .pipe(Effect.mapError((cause) => new Failure({ cause })));
    if (thread === null || thread.deletedAt !== null) {
      return yield* new DocumentCommentThreadNotFoundError({ threadId: scope.threadId });
    }
    const comments = yield* documentComments
      .list(scope.threadId)
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
        // Re-resolving keeps the first note, so the tool stays idempotent.
        const resolved = yield* documentComments
          .mutate({
            threadId,
            mutation: {
              type: "resolve",
              commentId: comment.id,
              resolution: input.resolution ?? null,
            },
          })
          .pipe(
            Effect.map(() => true),
            // The only rejection here is an unknown id: the user deleted it meanwhile.
            Effect.catchTag("ThreadDocumentCommentsError", () => Effect.succeed(false)),
          );
        if (!resolved) {
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
