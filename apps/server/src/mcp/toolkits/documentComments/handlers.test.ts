import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ThreadDocumentComment,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { OrchestrationCommandInvariantError } from "../../../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { DocumentCommentsToolkitHandlersLive } from "./handlers.ts";
import { DocumentCommentsToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const thread: OrchestrationThreadShell = {
  id: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: "2026-08-20T00:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

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
  readonly thread?: OrchestrationThreadShell | null;
  readonly comments?: ReadonlyArray<ThreadDocumentComment>;
  readonly reject?: (command: OrchestrationCommand) => OrchestrationCommandInvariantError | null;
}

const makeHarness = Effect.fn("makeDocumentCommentsToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const shell = options.thread === undefined ? thread : options.thread;
  const comments = options.comments ?? [];
  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const rejection = options.reject?.(command) ?? null;
      if (rejection !== null) return yield* rejection;
      yield* Ref.update(commands, (recorded) => [...recorded, command]);
      return { sequence: 1 };
    });
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Effect.succeed(threadId === THREAD_ID ? Option.fromNullishOr(shell) : Option.none()),
      listThreadDocumentComments: (threadId) =>
        Effect.succeed(threadId === THREAD_ID ? comments : []),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch,
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
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
      const commands = yield* Ref.get(harness.commands);
      expect(commands).toMatchObject([
        {
          type: "thread.document-comment.resolve",
          threadId: THREAD_ID,
          commentId: "comment-1",
          resolution: "Split the section in two.",
        },
      ]);
      expect(commands[0]?.commandId).toMatch(
        new RegExp(`^server:mcp-document-comment-resolve:${THREAD_ID}:`),
      );
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
        reject: (command) =>
          new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail: "does not exist",
          }),
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
