import { assert, describe, it } from "@effect/vitest";
import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as DocumentComments from "./DocumentComments.ts";

const THREAD_ID = ThreadId.make("thread-1");
const anchor = {
  text: "the quoted passage",
  start: 10,
  end: 28,
  prefix: "",
  suffix: "",
  startLine: 3,
  endLine: 5,
};

const TestLayer = DocumentComments.layer.pipe(
  Layer.provide(
    Layer.mock(Orchestrator.OrchestratorV2)({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === THREAD_ID
            ? ({ id: THREAD_ID, deletedAt: null } as unknown as OrchestrationV2ThreadShell)
            : null,
        ),
    }),
  ),
  Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
);

describe("DocumentComments", () => {
  it.layer(TestLayer)("on a thread", (it) => {
    it.effect("adds, edits, resolves, reopens and deletes comments, streaming each list", () =>
      Effect.gen(function* () {
        const comments = yield* DocumentComments.DocumentComments;
        // The stream subscribes before its first read, so once that read arrives no change is missed.
        const subscribed = yield* Deferred.make<void>();
        const seen = yield* comments.stream(THREAD_ID).pipe(
          Stream.tap(() => Deferred.succeed(subscribed, undefined)),
          Stream.take(6),
          Stream.map((change) => change.comments.map((comment) => comment.status)),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        const mutate = (mutation: Parameters<typeof comments.mutate>[0]["mutation"]) =>
          comments.mutate({ threadId: THREAD_ID, mutation });

        yield* mutate({
          type: "add",
          commentId: "c1",
          filePath: "README.md",
          anchor,
          body: "Tighten this",
        });
        yield* mutate({ type: "update", commentId: "c1", body: "Tighten this section" });
        yield* mutate({ type: "resolve", commentId: "c1", resolution: "Done." });
        // Re-resolving keeps the first note.
        const again = yield* mutate({ type: "resolve", commentId: "c1", resolution: "Other" });
        assert.strictEqual(again.comments[0]?.resolution, "Done.");
        yield* mutate({ type: "reopen", commentId: "c1" });
        const deleted = yield* mutate({ type: "delete", commentId: "c1" });
        assert.deepStrictEqual(deleted.comments, []);

        assert.deepStrictEqual(yield* Fiber.join(seen), [
          [],
          ["open"],
          ["open"],
          ["resolved"],
          ["resolved"],
          ["open"],
        ]);
        assert.deepStrictEqual(yield* comments.list(THREAD_ID), []);
      }),
    );

    it.effect("refuses duplicate ids, unknown ids and unknown threads", () =>
      Effect.gen(function* () {
        const comments = yield* DocumentComments.DocumentComments;
        yield* comments.mutate({
          threadId: THREAD_ID,
          mutation: { type: "add", commentId: "c2", filePath: "a.md", anchor, body: "One" },
        });
        const duplicate = yield* comments
          .mutate({
            threadId: THREAD_ID,
            mutation: { type: "add", commentId: "c2", filePath: "a.md", anchor, body: "Two" },
          })
          .pipe(Effect.flip);
        assert.include(duplicate.message, "already exists");
        const unknown = yield* comments
          .mutate({ threadId: THREAD_ID, mutation: { type: "delete", commentId: "nope" } })
          .pipe(Effect.flip);
        assert.include(unknown.message, "does not exist");
        const missingThread = yield* comments
          .mutate({
            threadId: ThreadId.make("missing"),
            mutation: { type: "delete", commentId: "c2" },
          })
          .pipe(Effect.flip);
        assert.include(missingThread.message, "Thread missing");
      }),
    );
  });
});
