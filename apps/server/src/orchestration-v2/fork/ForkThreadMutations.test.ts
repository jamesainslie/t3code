import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  SNOOZE_REMINDER_NOTICE_TITLE,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  decideForkThreadUpdate,
  forkCreateFields,
  forkSnoozeFields,
  type ForkMutationDeps,
  type ForkThreadCommand,
} from "./ForkThreadMutations.ts";

const now = DateTime.makeUnsafe("2026-10-05T12:00:00.000Z");
const earlier = DateTime.makeUnsafe("2026-10-05T09:00:00.000Z");
const later = DateTime.makeUnsafe("2026-10-06T09:00:00.000Z");

const makeThread = (
  id: string,
  overrides: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id: ThreadId.make(id),
  projectId: ProjectId.make("project-1"),
  title: id,
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.4",
  } as ModelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
  forkedFrom: null,
  createdAt: earlier,
  updatedAt: earlier,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...overrides,
});

const depsFor = (
  threads: ReadonlyArray<OrchestrationV2AppThread>,
  options: { readonly blocking?: boolean } = {},
): ForkMutationDeps => ({
  now,
  getThread: (threadId) => Effect.succeed(threads.find((thread) => thread.id === threadId) ?? null),
  hasBlockingWork: () => Effect.succeed(options.blocking ?? false),
  nextTurnItemOrdinal: Effect.succeed(7),
});

const update = (
  threadId: string,
  value: ForkThreadCommand["update"],
  internal = false,
): ForkThreadCommand =>
  ({
    type: internal ? "thread.fork.internal-update" : "thread.fork.update",
    commandId: CommandId.make(`command-${threadId}`),
    threadId: ThreadId.make(threadId),
    update: value,
  }) as ForkThreadCommand;

describe("decideForkThreadUpdate", () => {
  it.effect("sets and clears a highlight without moving the thread", () =>
    Effect.gen(function* () {
      const thread = makeThread("a");
      const set = yield* decideForkThreadUpdate(
        update("a", { kind: "highlight.set", color: "#ff8800" }),
        thread,
        depsFor([thread]),
      );
      assert.strictEqual(set.thread.highlightColor, "#ff8800");
      assert.deepStrictEqual(set.thread.updatedAt, thread.updatedAt);
      const cleared = yield* decideForkThreadUpdate(
        update("a", { kind: "highlight.set", color: null }),
        set.thread,
        depsFor([set.thread]),
      );
      assert.isNull(cleared.thread.highlightColor);
    }),
  );

  it.effect("links a dependency and wakes a snoozed thread, delivering its note", () =>
    Effect.gen(function* () {
      const waiter = makeThread("waiter", {
        snoozedUntil: later,
        snoozedAt: earlier,
        snoozeReminder: "Check the deploy",
      });
      const dependency = makeThread("dependency");
      const outcome = yield* decideForkThreadUpdate(
        update("waiter", { kind: "dependency.add", dependsOnThreadId: dependency.id }),
        waiter,
        depsFor([waiter, dependency]),
      );
      assert.deepStrictEqual(
        outcome.thread.dependencies?.map((link) => [link.threadId, link.satisfiedAt]),
        [[dependency.id, null]],
      );
      assert.isNull(outcome.thread.snoozedUntil);
      assert.isNull(outcome.thread.snoozeReminder);
      assert.strictEqual(outcome.notice?.type, "system_notice");
      assert.strictEqual(outcome.notice?.title, SNOOZE_REMINDER_NOTICE_TITLE);
      assert.strictEqual(
        outcome.notice?.type === "system_notice" ? outcome.notice.message : null,
        "Check the deploy",
      );
    }),
  );

  it.effect("keeps the original link when the same dependency is added again", () =>
    Effect.gen(function* () {
      const dependency = makeThread("dependency");
      const waiter = makeThread("waiter", {
        dependencies: [
          {
            threadId: dependency.id,
            linkedAt: "2026-10-05T08:00:00.000Z",
            satisfiedAt: null,
            satisfiedReason: null,
          },
        ],
      });
      const outcome = yield* decideForkThreadUpdate(
        update("waiter", { kind: "dependency.add", dependsOnThreadId: dependency.id }),
        waiter,
        depsFor([waiter, dependency]),
      );
      assert.strictEqual(outcome.thread.dependencies?.[0]?.linkedAt, "2026-10-05T08:00:00.000Z");
      assert.deepStrictEqual(outcome.thread.updatedAt, waiter.updatedAt);
    }),
  );

  it.effect("refuses links that cannot end: self, cycles, archived, synced, blocked", () =>
    Effect.gen(function* () {
      const a = makeThread("a");
      const b = makeThread("b", {
        dependencies: [
          {
            threadId: a.id,
            linkedAt: "2026-10-05T08:00:00.000Z",
            satisfiedAt: null,
            satisfiedReason: null,
          },
        ],
      });
      const archived = makeThread("archived", { archivedAt: earlier });
      const synced = makeThread("t3sync-other");
      const threads = [a, b, archived, synced];
      const refused = (dependsOn: ThreadId, options: { readonly blocking?: boolean } = {}) =>
        decideForkThreadUpdate(
          update("a", { kind: "dependency.add", dependsOnThreadId: dependsOn }),
          a,
          depsFor(threads, options),
        ).pipe(
          Effect.flip,
          Effect.map((error) => error.reason),
        );
      assert.include(yield* refused(a.id), "itself");
      assert.include(yield* refused(b.id), "cycle");
      assert.include(yield* refused(archived.id), "archived");
      assert.include(yield* refused(synced.id), "Synced");
      const free = makeThread("free");
      threads.push(free);
      assert.include(yield* refused(free.id, { blocking: true }), "pending request");
    }),
  );

  it.effect("removes links and satisfies open ones", () =>
    Effect.gen(function* () {
      const link = (id: string) => ({
        threadId: ThreadId.make(id),
        linkedAt: "2026-10-05T08:00:00.000Z",
        satisfiedAt: null,
        satisfiedReason: null,
      });
      const waiter = makeThread("waiter", { dependencies: [link("x"), link("y")] });
      const satisfied = yield* decideForkThreadUpdate(
        update(
          "waiter",
          {
            kind: "dependency.satisfy",
            dependsOnThreadId: ThreadId.make("x"),
            reason: "turn-finished",
            satisfiedAt: "2026-10-05T12:00:00.000Z",
          },
          true,
        ),
        waiter,
        depsFor([waiter]),
      );
      assert.deepStrictEqual(
        satisfied.thread.dependencies?.map((entry) => entry.satisfiedReason),
        ["turn-finished", null],
      );
      const repeated = yield* decideForkThreadUpdate(
        update(
          "waiter",
          {
            kind: "dependency.satisfy",
            dependsOnThreadId: ThreadId.make("x"),
            reason: "turn-finished",
            satisfiedAt: "2026-10-05T12:00:00.000Z",
          },
          true,
        ),
        satisfied.thread,
        depsFor([satisfied.thread]),
      );
      assert.strictEqual(repeated.thread, satisfied.thread);
      const removed = yield* decideForkThreadUpdate(
        update("waiter", { kind: "dependency.remove", dependsOnThreadIds: [ThreadId.make("y")] }),
        satisfied.thread,
        depsFor([satisfied.thread]),
      );
      assert.deepStrictEqual(
        removed.thread.dependencies?.map((entry) => entry.threadId),
        [ThreadId.make("x")],
      );
    }),
  );

  it.effect("delivers a reminder only once its snooze has ended", () =>
    Effect.gen(function* () {
      const deliver = update("a", { kind: "snooze-reminder.deliver" }, true);
      const pending = makeThread("a", {
        snoozedUntil: later,
        snoozedAt: earlier,
        snoozeReminder: "Later",
      });
      const early = yield* decideForkThreadUpdate(deliver, pending, depsFor([pending]));
      assert.isNull(early.notice);
      assert.strictEqual(early.thread, pending);

      const woke = makeThread("a", { snoozeReminder: "Later" });
      const delivered = yield* decideForkThreadUpdate(deliver, woke, depsFor([woke]));
      assert.strictEqual(
        delivered.notice?.type === "system_notice" ? delivered.notice.message : null,
        "Later",
      );
      assert.strictEqual(delivered.notice?.ordinal, 7);
      assert.isNull(delivered.thread.snoozeReminder);

      const again = yield* decideForkThreadUpdate(deliver, delivered.thread, depsFor([]));
      assert.isNull(again.notice);
    }),
  );
});

describe("forkSnoozeFields", () => {
  it("keeps, clears, or replaces the note and drops open links", () => {
    const snoozed = makeThread("a", {
      snoozedUntil: later,
      snoozeReminder: "Keep me",
      dependencies: [
        { threadId: ThreadId.make("x"), linkedAt: "t", satisfiedAt: null, satisfiedReason: null },
      ],
    });
    assert.deepStrictEqual(forkSnoozeFields(snoozed, {}), {
      snoozeReminder: "Keep me",
      dependencies: [],
    });
    assert.strictEqual(forkSnoozeFields(snoozed, { reminder: "" }).snoozeReminder, null);
    assert.strictEqual(forkSnoozeFields(snoozed, { reminder: "New" }).snoozeReminder, "New");
    // A thread that is awake has no pending note to keep.
    assert.strictEqual(
      forkSnoozeFields(makeThread("b", { snoozeReminder: "Stale" }), {}).snoozeReminder,
      null,
    );
  });
});

describe("forkCreateFields", () => {
  it.effect("keeps the continuation link only when its source exists", () =>
    Effect.gen(function* () {
      const source = makeThread("source");
      const deleted = makeThread("deleted", { deletedAt: earlier });
      const deps = depsFor([source, deleted]);
      assert.deepStrictEqual(
        yield* forkCreateFields({ continuedFromThreadId: source.id }, deps.getThread),
        { continuedFromThreadId: source.id },
      );
      assert.deepStrictEqual(
        yield* forkCreateFields({ continuedFromThreadId: deleted.id }, deps.getThread),
        {},
      );
      assert.deepStrictEqual(
        yield* forkCreateFields(
          { continuedFromThreadId: ThreadId.make("missing") },
          deps.getThread,
        ),
        {},
      );
      assert.deepStrictEqual(yield* forkCreateFields({}, deps.getThread), {});
    }),
  );
});
