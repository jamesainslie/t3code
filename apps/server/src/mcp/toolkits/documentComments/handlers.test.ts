import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadDocumentCommentsError,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ThreadDocumentComment,
  type ThreadDocumentCommentMutateInput,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import * as DocumentComments from "../../../fork/DocumentComments.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DocumentCommentsToolkitHandlersLive } from "./handlers.ts";
import { DocumentCommentsToolkit } from "./tools.ts";

const THREAD_ID = ThreadId.make("thread-1");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
  requestNamespace: "test",
  thread: {
    threadId: THREAD_ID,
    providerSessionId: "provider-session-1",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
});

const thread = { id: THREAD_ID, deletedAt: null } as unknown as OrchestrationV2ThreadShell;

function makeComment(overrides: Partial<ThreadDocumentComment> = {}): ThreadDocumentComment {
  return {
    id: "comment-1",
    filePath: "docs/plan.md",
    anchor: {
      text: "the quoted passage",
      start: 10,
      end: 28,
      prefix: "",
      suffix: "",
      startLine: 3,
      endLine: 5,
    },
    body: "Tighten this section.",
    status: "open",
    resolution: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

interface HarnessOptions {
  readonly thread?: OrchestrationV2ThreadShell | null;
  readonly comments?: ReadonlyArray<ThreadDocumentComment>;
  /** Reject a mutation the way the service does for an id that no longer exists. */
  readonly reject?: (input: ThreadDocumentCommentMutateInput) => boolean;
}

const makeHarness = Effect.fn("makeDocumentCommentsToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<ThreadDocumentCommentMutateInput["mutation"]>>([]);
  const shell = options.thread === undefined ? thread : options.thread;
  const comments = options.comments ?? [];
  const dependencies = Layer.mergeAll(
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (threadId) => Effect.succeed(threadId === THREAD_ID ? shell : null),
    }),
    Layer.mock(DocumentComments.DocumentComments)({
      list: (threadId) => Effect.succeed(threadId === THREAD_ID ? comments : []),
      mutate: (input) =>
        options.reject?.(input) === true
          ? Effect.fail(new ThreadDocumentCommentsError({ message: "Comment no longer exists." }))
          : Ref.update(commands, (recorded) => [...recorded, input.mutation]).pipe(
              Effect.as({ threadId: input.threadId, comments }),
            ),
    }),
  );
  const toolkit = yield* DocumentCommentsToolkit.pipe(
    Effect.provide(DocumentCommentsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof DocumentCommentsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["document-comments"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the success shape.
      Effect.map(
        (chunk) =>
          chunk.at(-1)!.result as Tool.Success<(typeof DocumentCommentsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(dependencies),
    );
  return { commands, call };
});

describe("document comment toolkit handlers", () => {
  it.effect("refuses a credential without the document-comments capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("list_document_comments", {}, ["pull-requests"])
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "document-comments",
        threadId: THREAD_ID,
      });
    }),
  );

  it.effect("lists the thread's comments with their quoted lines, filtered on request", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        comments: [
          makeComment(),
          makeComment({
            id: "comment-2",
            filePath: "README.md",
            status: "resolved",
            resolution: "Reworded it.",
            resolvedAt: "2026-08-11T00:00:00.000Z",
          }),
        ],
      });
      const all = yield* harness.call("list_document_comments", {});
      expect(all.comments).toEqual([
        {
          id: "comment-1",
          filePath: "docs/plan.md",
          startLine: 3,
          endLine: 5,
          quote: "the quoted passage",
          body: "Tighten this section.",
          status: "open",
          resolution: null,
        },
        {
          id: "comment-2",
          filePath: "README.md",
          startLine: 3,
          endLine: 5,
          quote: "the quoted passage",
          body: "Tighten this section.",
          status: "resolved",
          resolution: "Reworded it.",
        },
      ]);
      const open = yield* harness.call("list_document_comments", { status: "open" });
      expect(open.comments.map((comment) => comment.id)).toEqual(["comment-1"]);
      const readme = yield* harness.call("list_document_comments", { filePath: "README.md" });
      expect(readme.comments.map((comment) => comment.id)).toEqual(["comment-2"]);
    }),
  );

  it.effect("resolves a comment on the token's thread with the agent's note", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ comments: [makeComment()] });
      const result = yield* harness.call("resolve_document_comment", {
        commentId: "comment-1",
        resolution: "Split the section in two.",
      });
      expect(result).toEqual({ commentId: "comment-1", resolved: true, alreadyResolved: false });
      expect(yield* Ref.get(harness.commands)).toEqual([
        { type: "resolve", commentId: "comment-1", resolution: "Split the section in two." },
      ]);
    }),
  );

  it.effect("reports an already resolved comment and resolves without a note", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        comments: [makeComment({ status: "resolved", resolution: "Done.", resolvedAt: "x" })],
      });
      const result = yield* harness.call("resolve_document_comment", { commentId: "comment-1" });
      expect(result).toEqual({ commentId: "comment-1", resolved: true, alreadyResolved: true });
      expect(yield* Ref.get(harness.commands)).toMatchObject([{ resolution: null }]);
    }),
  );

  it.effect("fails with a typed error for an unknown comment id", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ comments: [makeComment()] });
      const error = yield* harness
        .call("resolve_document_comment", { commentId: "comment-missing" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "DocumentCommentNotFoundError",
        commentId: "comment-missing",
      });
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }),
  );

  it.effect("treats a comment deleted before the dispatch landed as not found", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        comments: [makeComment()],
        reject: () => true,
      });
      const error = yield* harness
        .call("resolve_document_comment", { commentId: "comment-1" })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "DocumentCommentNotFoundError" });
    }),
  );

  it.effect("fails cleanly when the token's thread no longer exists", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ thread: null });
      const error = yield* harness.call("list_document_comments", {}).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "DocumentCommentThreadNotFoundError",
        threadId: THREAD_ID,
      });
    }),
  );
});
