import { ThreadId, type OrchestrationProjectShell, type ProjectId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { buildThreadDigest, toTurnDetail } from "./digest.ts";
import { renderThreadDigest, renderThreadMatches, renderTurnDetails } from "./render.ts";
import { canReadThread, canSearchThreads, collectReferencedThreadIds } from "./scope.ts";
import {
  FIND_THREADS_MAX_LIMIT,
  InvalidTurnRangeError,
  READ_THREAD_TURNS_DEFAULT_LIMIT,
  ThreadHistoryReadFailedError,
  ThreadHistoryToolkit,
  ThreadNotFoundError,
  ThreadOutOfScopeError,
  ThreadSearchOutOfScopeError,
} from "./tools.ts";
import { reconstructTurns } from "./turns.ts";

/** `searchThreads` returns messages, so ask for its maximum to fill a page of distinct threads. */
const SEARCH_MATCH_LIMIT = 50;

const readFailed = (cause: unknown) => new ThreadHistoryReadFailedError({ cause });

const make = Effect.gen(function* () {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  const threadDetail = (threadId: ThreadId) =>
    snapshots
      .getThreadDetailById(threadId)
      .pipe(
        Effect.mapError(readFailed),
        Effect.map(Option.filter((thread) => thread.deletedAt === null)),
      );

  const projectShell = (projectId: ProjectId) =>
    snapshots
      .getProjectShellById(projectId)
      .pipe(Effect.map(Option.getOrNull), Effect.mapError(readFailed));

  /**
   * The calling thread and its live settings. The level is re-read on every call so lowering
   * it applies at once, and references come only from the caller's own messages.
   */
  const loadCaller = Effect.fn("ThreadHistoryToolkit.loadCaller")(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("thread-history");
    const caller = yield* threadDetail(scope.threadId);
    if (Option.isNone(caller)) {
      return yield* new ThreadNotFoundError({ threadId: scope.threadId });
    }
    const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(readFailed));
    const resolved = resolveProjectSettings(settings, caller.value.projectId).settings;
    return {
      thread: caller.value,
      level: resolved.agentThreadHistoryAccess,
      recentTurns: resolved.agentThreadHistoryRecentTurns,
    };
  });

  /** The target thread, once the caller's level allows reading it. */
  const loadTarget = Effect.fn("ThreadHistoryToolkit.loadTarget")(function* (
    caller: Effect.Success<ReturnType<typeof loadCaller>>,
    rawThreadId: string,
  ) {
    const threadId = ThreadId.make(rawThreadId);
    const target = yield* threadDetail(threadId);
    if (Option.isNone(target)) return yield* new ThreadNotFoundError({ threadId });
    const allowed = canReadThread({
      callerThreadId: caller.thread.id,
      callerProjectId: caller.thread.projectId,
      targetThreadId: target.value.id,
      targetProjectId: target.value.projectId,
      level: caller.level,
      referencedThreadIds: collectReferencedThreadIds(caller.thread),
    });
    if (!allowed) return yield* new ThreadOutOfScopeError({ threadId, level: caller.level });
    return target.value;
  });

  const matchOf = Effect.fn("ThreadHistoryToolkit.matchOf")(function* (
    threadId: ThreadId,
    projectTitles: Map<ProjectId, OrchestrationProjectShell | null>,
  ) {
    const shell = yield* snapshots
      .getThreadShellById(threadId)
      .pipe(Effect.map(Option.getOrNull), Effect.mapError(readFailed));
    if (shell === null) return null;
    if (!projectTitles.has(shell.projectId)) {
      projectTitles.set(shell.projectId, yield* projectShell(shell.projectId));
    }
    return {
      threadId: shell.id,
      title: shell.title,
      projectTitle: projectTitles.get(shell.projectId)?.title ?? null,
      branch: shell.branch,
      lastActivityAt: shell.updatedAt,
      status: shell.latestTurn?.state ?? "empty",
    };
  });

  return ThreadHistoryToolkit.of({
    read_thread: (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        const target = yield* loadTarget(caller, input.threadId);
        const project = yield* projectShell(target.projectId);
        const digest = buildThreadDigest({
          thread: target,
          projectTitle: project?.title ?? null,
          callerWorktreePath: caller.thread.worktreePath,
          recentTurns: Math.min(input.recentTurns ?? caller.recentTurns, caller.recentTurns),
        });
        return renderThreadDigest(digest);
      }),
    read_thread_turns: (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        const target = yield* loadTarget(caller, input.threadId);
        const turns = reconstructTurns(target);
        const { beforeTurn } = input;
        if (beforeTurn !== undefined && (beforeTurn < 2 || beforeTurn > turns.length + 1)) {
          return yield* new InvalidTurnRangeError({ beforeTurn, turnCount: turns.length });
        }
        // Turn n sits at index n - 1, so the turns before `beforeTurn` end at its index.
        const end = (beforeTurn ?? turns.length + 1) - 1;
        const start = Math.max(0, end - (input.limit ?? READ_THREAD_TURNS_DEFAULT_LIMIT));
        return renderTurnDetails(target.id, turns.slice(start, end).map(toTurnDetail), start);
      }),
    find_threads: (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        if (!canSearchThreads(caller.level)) {
          return yield* new ThreadSearchOutOfScopeError({ level: caller.level });
        }
        const { matches } = yield* snapshots
          .searchThreads({ query: input.query, limit: SEARCH_MATCH_LIMIT })
          .pipe(Effect.mapError(readFailed));
        const limit = Math.min(input.limit ?? FIND_THREADS_MAX_LIMIT, FIND_THREADS_MAX_LIMIT);
        const seen = new Set<ThreadId>();
        const projectTitles = new Map<ProjectId, OrchestrationProjectShell | null>();
        const results = [];
        for (const found of matches) {
          if (results.length >= limit) break;
          if (seen.has(found.threadId)) continue;
          seen.add(found.threadId);
          // Search lists only what the level covers; referenced threads are read directly.
          const inScope = canReadThread({
            callerThreadId: caller.thread.id,
            callerProjectId: caller.thread.projectId,
            targetThreadId: found.threadId,
            targetProjectId: found.projectId,
            level: caller.level,
            referencedThreadIds: new Set(),
          });
          if (!inScope) continue;
          const result = yield* matchOf(found.threadId, projectTitles);
          if (result !== null) results.push(result);
        }
        return renderThreadMatches(results);
      }),
  });
});

export const ThreadHistoryToolkitHandlersLive = ThreadHistoryToolkit.toLayer(make);
