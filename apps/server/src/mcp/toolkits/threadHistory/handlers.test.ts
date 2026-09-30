import {
  ComposerContextId,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationSearchThreadsInput,
  type OrchestrationThread,
  type OrchestrationThreadSearchMatch,
  type OrchestrationThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
  type ProjectionThreadDetailQuery,
  type ProjectionThreadReadOptions,
  type ProjectionThreadSearchOptions,
} from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ThreadHistoryToolkitHandlersLive } from "./handlers.ts";
import {
  activity,
  assistantMessage,
  at,
  latestTurn,
  makeThread,
  turn,
  userMessage,
} from "./testFixtures.ts";
import { ThreadHistoryToolkit } from "./tools.ts";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");
const CALLER_ID = ThreadId.make("thread-caller");
const REFERENCED_ID = ThreadId.make("thread-referenced");
const SAME_PROJECT_ID = ThreadId.make("thread-same-project");
const OTHER_PROJECT_ID = ThreadId.make("thread-other-project");
const DELETED_ID = ThreadId.make("thread-deleted");

const threadRecord = (threadId: ThreadId, projectId: ProjectId) => ({
  version: 1 as const,
  contextId: ComposerContextId.make(`context-${threadId}`),
  label: `Thread ${threadId}`,
  kind: "thread" as const,
  threadId,
  projectId,
  title: `Thread ${threadId}`,
});

const referencing = (id: string, t: number, threadId: ThreadId, projectId: ProjectId) =>
  ({
    ...userMessage(id, t),
    context: { version: 1, records: [threadRecord(threadId, projectId)] },
  }) satisfies OrchestrationMessage;

/** A thread with `count` completed turns, each a user message and its reply. */
const withTurns = (
  id: ThreadId,
  projectId: ProjectId,
  count: number,
  overrides: Partial<OrchestrationThread> = {},
) =>
  makeThread({
    id,
    projectId,
    title: `Thread ${id}`,
    messages: Array.from({ length: count }, (_, index) => [
      userMessage(`${id}-u${index + 1}`, 10 * (index + 1)),
      assistantMessage(`${id}-a${index + 1}`, 10 * (index + 1) + 1, turn(`${id}-t${index + 1}`)),
    ]).flat(),
    latestTurn: count > 0 ? latestTurn(turn(`${id}-t${count}`), "completed") : null,
    ...overrides,
  });

const caller = makeThread({
  id: CALLER_ID,
  projectId: PROJECT_A,
  worktreePath: "/work/a",
  messages: [referencing("caller-u1", 1, REFERENCED_ID, PROJECT_B)],
});

const baseThreads: ReadonlyArray<OrchestrationThread> = [
  caller,
  withTurns(REFERENCED_ID, PROJECT_B, 6),
  // The target naming itself (or anything else) must never widen what the caller may read.
  withTurns(SAME_PROJECT_ID, PROJECT_A, 12, {
    messages: [
      referencing("same-u0", 1, SAME_PROJECT_ID, PROJECT_A),
      ...withTurns(SAME_PROJECT_ID, PROJECT_A, 12).messages,
    ],
  }),
  withTurns(OTHER_PROJECT_ID, PROJECT_B, 1),
  withTurns(DELETED_ID, PROJECT_A, 1, { deletedAt: at(500) }),
];

const projectShell = (id: ProjectId, title: string): OrchestrationProjectShell => ({
  id,
  title,
  workspaceRoot: `/workspace/${id}`,
  defaultModelSelection: null,
  scripts: [],
  createdAt: at(0),
  updatedAt: at(0),
});

const projects = new Map([
  [PROJECT_A, projectShell(PROJECT_A, "Alpha")],
  [PROJECT_B, projectShell(PROJECT_B, "Beta")],
]);

const shellOf = (thread: OrchestrationThread): OrchestrationThreadShell => ({
  id: thread.id,
  projectId: thread.projectId,
  title: thread.title,
  modelSelection: thread.modelSelection,
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  branch: thread.branch,
  worktreePath: thread.worktreePath,
  pullRequests: thread.pullRequests,
  latestTurn: thread.latestTurn,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  archivedAt: thread.archivedAt,
  settledOverride: thread.settledOverride,
  settledAt: thread.settledAt,
  session: thread.session,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});

const settingsWith = (overrides: Partial<ServerSettings>): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  ...overrides,
});

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: CALLER_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

interface HarnessOptions {
  readonly settings?: ServerSettings;
  readonly threads?: ReadonlyArray<OrchestrationThread>;
  readonly matches?: ReadonlyArray<OrchestrationThreadSearchMatch>;
}

const makeHarness = Effect.fn("makeThreadHistoryToolkitHarness")(function* (
  options: HarnessOptions = {},
) {
  const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
  const searches = yield* Ref.make<
    ReadonlyArray<{
      readonly input: OrchestrationSearchThreadsInput;
      readonly options: ProjectionThreadSearchOptions | undefined;
    }>
  >([]);
  const detailReads = yield* Ref.make<
    ReadonlyArray<{ readonly threadId: ThreadId; readonly query: ProjectionThreadDetailQuery }>
  >([]);
  const turnActivityReads = yield* Ref.make<
    ReadonlyArray<Parameters<ProjectionSnapshotQueryShape["listTurnActivities"]>[0]>
  >([]);
  const threads = new Map((options.threads ?? baseThreads).map((thread) => [thread.id, thread]));
  // Like the real queries, archived threads are found only when asked for.
  const lookup = (threadId: ThreadId, read: ProjectionThreadReadOptions = {}) =>
    Option.fromNullishOr(threads.get(threadId)).pipe(
      Option.filter((thread) => thread.archivedAt === null || read.includeArchived === true),
    );
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      // Kind filters apply as SQLite applies them, so tests see only the rows the handler asked for.
      getThreadDetailById: (threadId, query = {}) =>
        Ref.update(detailReads, (recorded) => [...recorded, { threadId, query }]).pipe(
          Effect.as(
            lookup(threadId, query).pipe(
              Option.map((thread) => {
                const kinds = query.activityKinds;
                return kinds === undefined
                  ? thread
                  : {
                      ...thread,
                      activities: thread.activities.filter((row) => kinds.includes(row.kind)),
                    };
              }),
            ),
          ),
        ),
      listTurnActivities: (input) =>
        Ref.update(turnActivityReads, (recorded) => [...recorded, input]).pipe(
          Effect.as(
            (threads.get(input.threadId)?.activities ?? []).filter(
              (row) =>
                input.kinds.includes(row.kind) &&
                row.turnId !== null &&
                input.turnIds.includes(row.turnId),
            ),
          ),
        ),
      getThreadShellById: (threadId, read) =>
        Effect.succeed(
          lookup(threadId, read).pipe(
            Option.filter((thread) => thread.deletedAt === null),
            Option.map(shellOf),
          ),
        ),
      getProjectShellById: (projectId) =>
        Effect.succeed(Option.fromNullishOr(projects.get(projectId))),
      searchThreads: (input, searchOptions) =>
        Ref.update(searches, (recorded) => [...recorded, { input, options: searchOptions }]).pipe(
          Effect.as({ matches: options.matches ?? [] }),
        ),
    }),
    Layer.mock(ServerSettingsService)({ getSettings: Ref.get(settings) }),
  );
  const toolkit = yield* ThreadHistoryToolkit.pipe(
    Effect.provide(ThreadHistoryToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof ThreadHistoryToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["thread-history"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      // Failure mode is "error", so a delivered result is always the text.
      Effect.map((chunk) => chunk.at(-1)!.result as string),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(dependencies),
    );
  return { settings, searches, detailReads, turnActivityReads, call };
});

/** Turn numbers rendered in detail, in order. */
const detailedTurns = (text: string) =>
  [...text.matchAll(/<turn n="(\d+)" state="[a-z]+">\n/g)].map((match) => Number(match[1]));

const recentSection = (text: string) =>
  text.slice(text.indexOf("<recent_turns>"), text.indexOf("</recent_turns>"));

const match = (threadId: ThreadId, projectId: ProjectId): OrchestrationThreadSearchMatch => ({
  threadId,
  projectId,
  source: "user",
  snippet: "ssh log",
  messageCreatedAt: at(10),
});

describe("thread history toolkit handlers", () => {
  it.effect("read_thread returns a digest for a referenced thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const text = yield* harness.call("read_thread", { threadId: REFERENCED_ID });
      expect(text.startsWith(`<thread id="${REFERENCED_ID}"`)).toBe(true);
      expect(text).toContain('project="Beta"');
      expect(text.endsWith("</thread>")).toBe(true);
    }),
  );

  it.effect("read_thread refuses an unreferenced thread at the referenced level", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("read_thread", { threadId: SAME_PROJECT_ID })
        .pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "ThreadOutOfScopeError",
        threadId: SAME_PROJECT_ID,
        level: "referenced",
      });
      expect(error.message).toBe(
        `Thread ${SAME_PROJECT_ID} is outside what this thread may read (thread history access: Referenced threads). Ask the user to reference the thread in a message, or to raise "Agent thread history" in Settings.`,
      );
    }),
  );

  it.effect("read_thread picks up a lowered level on the next call", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
      });
      const text = yield* harness.call("read_thread", { threadId: SAME_PROJECT_ID });
      expect(text.startsWith(`<thread id="${SAME_PROJECT_ID}"`)).toBe(true);

      // Lowered for the caller's project only, so the project override must be resolved.
      yield* Ref.set(
        harness.settings,
        settingsWith({
          agentThreadHistoryAccess: "project",
          projectSettingsOverrides: { [PROJECT_A]: { agentThreadHistoryAccess: "referenced" } },
        }),
      );
      const error = yield* harness
        .call("read_thread", { threadId: SAME_PROJECT_ID })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ThreadOutOfScopeError", level: "referenced" });
    }),
  );

  it.effect("read_thread reports a missing thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "environment" }),
      });
      for (const threadId of [ThreadId.make("thread-unknown"), DELETED_ID]) {
        const error = yield* harness.call("read_thread", { threadId }).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ThreadNotFoundError", threadId });
        expect(error.message).toBe(`Thread ${threadId} was not found in this T3 Code environment.`);
      }
    }),
  );

  it.effect("reads and finds archived threads like active ones", () =>
    Effect.gen(function* () {
      const archivedId = ThreadId.make("thread-archived");
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
        threads: [
          caller,
          withTurns(REFERENCED_ID, PROJECT_B, 2, { archivedAt: at(400) }),
          withTurns(archivedId, PROJECT_A, 1, { archivedAt: at(400) }),
        ],
        matches: [match(archivedId, PROJECT_A)],
      });

      const referenced = yield* harness.call("read_thread", { threadId: REFERENCED_ID });
      expect(referenced.startsWith(`<thread id="${REFERENCED_ID}"`)).toBe(true);
      const page = yield* harness.call("read_thread_turns", { threadId: archivedId });
      expect(detailedTurns(page)).toEqual([1]);
      const found = yield* harness.call("find_threads", { query: "ssh log" });
      expect(found).toContain(`id="${archivedId}"`);
    }),
  );

  it.effect("read_thread requires the thread-history capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const errors = [
        yield* harness
          .call("read_thread", { threadId: REFERENCED_ID }, ["pull-requests"])
          .pipe(Effect.flip),
        yield* harness
          .call("find_threads", { query: "ssh log" }, ["pull-requests"])
          .pipe(Effect.flip),
      ];
      for (const error of errors) {
        expect(error._tag).toBe("ThreadHistoryOffError");
        expect(error.message).toBe(
          'Thread history is off for this thread. Ask the user to turn on "Agent thread history" in Settings; it applies from the thread\'s next session.',
        );
      }
    }),
  );

  it.effect("read_thread does not suggest references when the level is off", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "off" }),
      });
      const error = yield* harness
        .call("read_thread", { threadId: REFERENCED_ID })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ThreadOutOfScopeError", level: "off" });
      expect(error.message).toBe(
        'Thread history is off for this thread\'s project. Ask the user to turn on "Agent thread history" in Settings.',
      );
    }),
  );

  it.effect("loads tool payloads only for the turns rendered in detail", () =>
    Effect.gen(function* () {
      const toolCall = (id: string, t: number, turnNumber: number, command: string) =>
        activity({
          id,
          t,
          kind: "tool.completed",
          tone: "tool",
          turnId: turn(`${REFERENCED_ID}-t${turnNumber}`),
          payload: { status: "completed", detail: command, data: { toolName: "Bash" } },
        });
      const target = withTurns(REFERENCED_ID, PROJECT_B, 6, {
        activities: [toolCall("tool-1", 12, 1, "vp i"), toolCall("tool-6", 62, 6, "vp test")],
      });
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryRecentTurns: 2 }),
        threads: [caller, target, ...baseThreads.slice(2)],
      });

      const digest = yield* harness.call("read_thread", { threadId: REFERENCED_ID });
      expect(recentSection(digest)).toContain("Bash completed: vp test");
      const [callerRead, targetRead] = yield* Ref.get(harness.detailReads);
      // The caller contributes only its id, project, worktree, and messages.
      expect(callerRead).toEqual({
        threadId: CALLER_ID,
        query: { activityKinds: [], includeArchived: true },
      });
      expect(targetRead?.threadId).toBe(REFERENCED_ID);
      const targetKinds = targetRead?.query.activityKinds ?? [];
      expect(targetKinds).toContain("runtime.error");
      for (const kind of ["tool.completed", "tool.updated", "tool.started", "task.progress"]) {
        expect(targetKinds).not.toContain(kind);
      }
      expect(yield* Ref.get(harness.turnActivityReads)).toEqual([
        {
          threadId: REFERENCED_ID,
          kinds: ["tool.completed"],
          turnIds: [turn(`${REFERENCED_ID}-t5`), turn(`${REFERENCED_ID}-t6`)],
        },
      ]);

      const page = yield* harness.call("read_thread_turns", {
        threadId: REFERENCED_ID,
        beforeTurn: 3,
        limit: 2,
      });
      expect(page).toContain("Bash completed: vp i");
      expect((yield* Ref.get(harness.turnActivityReads)).at(-1)?.turnIds).toEqual([
        turn(`${REFERENCED_ID}-t1`),
        turn(`${REFERENCED_ID}-t2`),
      ]);
    }),
  );

  it.effect("find_threads reads the caller's shell, not its detail", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
        matches: [match(SAME_PROJECT_ID, PROJECT_A)],
      });
      const text = yield* harness.call("find_threads", { query: "ssh log" });
      expect(text).toContain(`id="${SAME_PROJECT_ID}"`);
      expect(yield* Ref.get(harness.detailReads)).toEqual([]);
    }),
  );

  it.effect("find_threads searches every project at the environment level", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "environment" }),
        matches: [match(OTHER_PROJECT_ID, PROJECT_B)],
      });
      const text = yield* harness.call("find_threads", { query: "ssh log" });
      expect(text).toContain(`id="${OTHER_PROJECT_ID}"`);
      expect(yield* Ref.get(harness.searches)).toEqual([
        { input: { query: "ssh log", limit: 50 }, options: { includeArchived: true } },
      ]);
    }),
  );

  it.effect("read_thread caps recentTurns at the setting", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryRecentTurns: 2 }),
      });
      const capped = yield* harness.call("read_thread", {
        threadId: REFERENCED_ID,
        recentTurns: 9,
      });
      expect(detailedTurns(recentSection(capped))).toEqual([5, 6]);

      const fewer = yield* harness.call("read_thread", { threadId: REFERENCED_ID, recentTurns: 1 });
      expect(detailedTurns(recentSection(fewer))).toEqual([6]);
    }),
  );

  it.effect("read_thread_turns returns the five turns before beforeTurn", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
      });
      const page = yield* harness.call("read_thread_turns", {
        threadId: SAME_PROJECT_ID,
        beforeTurn: 10,
      });
      expect(page.startsWith(`<thread id="${SAME_PROJECT_ID}">`)).toBe(true);
      expect(detailedTurns(page)).toEqual([5, 6, 7, 8, 9]);
      expect(page).toContain('<more before_turn="5" omitted_turns="4"/>');

      const latest = yield* harness.call("read_thread_turns", {
        threadId: SAME_PROJECT_ID,
        limit: 3,
      });
      expect(detailedTurns(latest)).toEqual([10, 11, 12]);
    }),
  );

  it.effect("read_thread_turns rejects beforeTurn out of range", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
      });
      for (const beforeTurn of [1, 14]) {
        const error = yield* harness
          .call("read_thread_turns", { threadId: SAME_PROJECT_ID, beforeTurn })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "InvalidTurnRangeError",
          beforeTurn,
          turnCount: 12,
        });
        expect(error.message).toBe("beforeTurn must be between 2 and 13.");
      }
      const last = yield* harness.call("read_thread_turns", {
        threadId: SAME_PROJECT_ID,
        beforeTurn: 13,
      });
      expect(detailedTurns(last)).toEqual([8, 9, 10, 11, 12]);
    }),
  );

  it.effect("read_thread_turns says so when the thread has no turns", () =>
    Effect.gen(function* () {
      const emptyId = ThreadId.make("thread-empty");
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
        threads: [caller, withTurns(emptyId, PROJECT_A, 0)],
      });
      const error = yield* harness
        .call("read_thread_turns", { threadId: emptyId, beforeTurn: 2 })
        .pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "InvalidTurnRangeError", turnCount: 0 });
      expect(error.message).toBe("This thread has no turns yet.");
    }),
  );

  it.effect("find_threads refuses below the project level", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ matches: [match(SAME_PROJECT_ID, PROJECT_A)] });
      const error = yield* harness.call("find_threads", { query: "ssh log" }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "ThreadSearchOutOfScopeError", level: "referenced" });
      expect(error.message).toBe(
        'Searching threads is not allowed at this thread\'s history access level (Referenced threads). Ask the user to raise "Agent thread history" in Settings to This project or All projects.',
      );
      expect(yield* Ref.get(harness.searches)).toEqual([]);
    }),
  );

  it.effect("find_threads limits results to the caller's project at the project level", () =>
    Effect.gen(function* () {
      const extra = Array.from({ length: 25 }, (_, index) =>
        withTurns(ThreadId.make(`thread-extra-${index}`), PROJECT_A, 1),
      );
      const harness = yield* makeHarness({
        settings: settingsWith({ agentThreadHistoryAccess: "project" }),
        threads: [...baseThreads, ...extra],
        matches: [
          // The caller's own thread is never a search result.
          match(CALLER_ID, PROJECT_A),
          match(SAME_PROJECT_ID, PROJECT_A),
          match(OTHER_PROJECT_ID, PROJECT_B),
          // Referenced threads are read directly; search lists only what the level covers.
          match(REFERENCED_ID, PROJECT_B),
          match(SAME_PROJECT_ID, PROJECT_A),
          match(DELETED_ID, PROJECT_A),
          ...extra.map((thread) => match(thread.id, PROJECT_A)),
        ],
      });
      const text = yield* harness.call("find_threads", { query: "ssh log" });
      expect(yield* Ref.get(harness.searches)).toEqual([
        {
          input: { query: "ssh log", limit: 50 },
          options: { includeArchived: true, projectId: PROJECT_A },
        },
      ]);

      const lines = text.split("\n");
      const ids = lines.map((line) => /id="([^"]+)"/.exec(line)?.[1]);
      expect(lines).toHaveLength(20);
      expect(ids[0]).toBe(SAME_PROJECT_ID);
      expect(ids.filter((id) => id === SAME_PROJECT_ID)).toHaveLength(1);
      expect(ids).not.toContain(OTHER_PROJECT_ID);
      expect(ids).not.toContain(REFERENCED_ID);
      expect(ids).not.toContain(DELETED_ID);
      expect(ids).not.toContain(CALLER_ID);
      expect(lines[0]).toContain('project="Alpha"');
      expect(lines[0]).toContain('status="completed"');

      const limited = yield* harness.call("find_threads", { query: "ssh log", limit: 2 });
      expect(limited.split("\n")).toHaveLength(2);
    }),
  );
});
