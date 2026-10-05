import {
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2ThreadShell,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as DocumentComments from "../../../fork/DocumentComments.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { buildThreadDigest, recentStart, toTurnDetail } from "./digest.ts";
import { renderThreadDigest, renderThreadMatches, renderTurnDetails } from "./render.ts";
import { canReadThread, canSearchThreads, collectReferencedThreadIds } from "./scope.ts";
import {
  FIND_THREADS_MAX_LIMIT,
  InvalidTurnRangeError,
  READ_THREAD_TURNS_DEFAULT_LIMIT,
  ThreadHistoryOffError,
  ThreadHistoryReadFailedError,
  ThreadHistoryToolkit,
  ThreadNotFoundError,
  ThreadOutOfScopeError,
  ThreadSearchOutOfScopeError,
} from "./tools.ts";
import { reconstructTurns, type HistoryThread } from "./turns.ts";

/** Search returns one match per thread; ask for its maximum to fill a page after scoping. */
const SEARCH_MATCH_LIMIT = 50;

const readFailed = (cause: unknown) => new ThreadHistoryReadFailedError({ cause });

/** The calling thread. History is read relative to it, so a caller outside a thread has none. */
const requireThreadHistory = McpInvocationContext.requireMcpCapability("thread-history").pipe(
  Effect.mapError(() => new ThreadHistoryOffError()),
  Effect.flatMap((scope) =>
    scope.thread === undefined
      ? Effect.fail(new ThreadHistoryOffError())
      : Effect.succeed({ threadId: scope.thread.threadId }),
  ),
);

const make = Effect.gen(function* () {
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const threadSearch = yield* ThreadSearch.ThreadSearch;
  const projects = yield* ProjectService.ProjectService;
  const documentComments = yield* DocumentComments.DocumentComments;
  const serverSettings = yield* ServerSettings.ServerSettingsService;

  /**
   * A whole thread, with its v1 transcript imported first when it predates v2. Archived
   * threads hold finished work an agent may pick up, so they read like active ones.
   */
  const threadDetail = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const shell = yield* threadShell(threadId);
      if (shell === null) return Option.none<HistoryThread>();
      yield* threadManagement.ensureLegacyTranscript(threadId).pipe(Effect.ignore);
      const projection = yield* threadManagement
        .getThreadProjection(threadId)
        .pipe(Effect.mapError(readFailed));
      return Option.some<HistoryThread>(projection);
    });

  const threadShell = (threadId: ThreadId) =>
    threadManagement.getThreadShell(threadId).pipe(
      Effect.map((shell) => (shell === null || shell.deletedAt !== null ? null : shell)),
      Effect.mapError(readFailed),
    );

  const projectShell = (projectId: ProjectId) =>
    projects.getShell(projectId).pipe(Effect.map(Option.getOrNull), Effect.mapError(readFailed));

  /** The caller's live settings, re-read on every call so lowering them applies at once. */
  const accessFor = Effect.fn("ThreadHistoryToolkit.accessFor")(function* (projectId: ProjectId) {
    const settings = yield* serverSettings.getSettings.pipe(Effect.mapError(readFailed));
    const resolved = resolveProjectSettings(settings, projectId).settings;
    return {
      level: resolved.agentThreadHistoryAccess,
      recentTurns: resolved.agentThreadHistoryRecentTurns,
    };
  });

  /** The calling thread, its user messages (which carry its references), and its settings. */
  const loadCaller = Effect.fn("ThreadHistoryToolkit.loadCaller")(function* () {
    const scope = yield* requireThreadHistory;
    const shell = yield* threadShell(scope.threadId);
    if (shell === null) return yield* new ThreadNotFoundError({ threadId: scope.threadId });
    const records = yield* threadManagement
      .getThreadRecords(scope.threadId, ["messages"], { messageRoles: ["user"] })
      .pipe(Effect.mapError(readFailed));
    return {
      thread: {
        id: shell.id,
        projectId: shell.projectId,
        worktreePath: shell.worktreePath,
        continuedFromThreadId: shell.continuedFromThreadId ?? null,
        messages: records.messages as ReadonlyArray<OrchestrationV2ConversationMessage>,
      },
      ...(yield* accessFor(shell.projectId)),
    };
  });

  type Caller = Effect.Success<ReturnType<typeof loadCaller>>;

  const callerMayRead = (
    caller: Caller,
    target: { readonly id: ThreadId; readonly projectId: ProjectId },
  ) =>
    canReadThread({
      callerThreadId: caller.thread.id,
      callerProjectId: caller.thread.projectId,
      targetThreadId: target.id,
      targetProjectId: target.projectId,
      level: caller.level,
      referencedThreadIds: collectReferencedThreadIds(caller.thread),
    });

  /** The target thread, once the caller's level allows reading it. */
  const loadTarget = Effect.fn("ThreadHistoryToolkit.loadTarget")(function* (
    caller: Caller,
    rawThreadId: string,
  ) {
    const threadId = ThreadId.make(rawThreadId);
    const shell = yield* threadShell(threadId);
    if (shell === null) return yield* new ThreadNotFoundError({ threadId });
    if (!callerMayRead(caller, shell)) {
      return yield* new ThreadOutOfScopeError({ threadId, level: caller.level });
    }
    const target = yield* threadDetail(threadId);
    if (Option.isNone(target)) return yield* new ThreadNotFoundError({ threadId });
    return target.value;
  });

  const matchOf = Effect.fn("ThreadHistoryToolkit.matchOf")(function* (
    shell: OrchestrationV2ThreadShell,
    projectTitles: Map<ProjectId, OrchestrationProjectShell | null>,
  ) {
    if (!projectTitles.has(shell.projectId)) {
      projectTitles.set(shell.projectId, yield* projectShell(shell.projectId));
    }
    return {
      threadId: shell.id,
      title: shell.title,
      projectTitle: projectTitles.get(shell.projectId)?.title ?? null,
      branch: shell.branch,
      lastActivityAt: DateTime.formatIso(shell.updatedAt),
      status: shell.status,
    };
  });

  return ThreadHistoryToolkit.of({
    read_thread: (input) =>
      Effect.gen(function* () {
        const caller = yield* loadCaller();
        const target = yield* loadTarget(caller, input.threadId);
        const project = yield* projectShell(target.thread.projectId);
        // The source keeps its id in the digest; its title shows only when the caller could
        // read it, so a deleted or out-of-scope source stays untitled.
        const sourceId = target.thread.continuedFromThreadId ?? null;
        const source = sourceId === null ? null : yield* threadShell(sourceId);
        const sourceTitle = source && callerMayRead(caller, source) ? source.title : null;
        const recentTurns = Math.min(input.recentTurns ?? caller.recentTurns, caller.recentTurns);
        const comments = yield* documentComments
          .list(target.thread.id)
          .pipe(Effect.orElseSucceed(() => []));
        const digest = buildThreadDigest({
          thread: target,
          comments,
          projectTitle: project?.title ?? null,
          continuedFromTitle: sourceTitle,
          callerWorktreePath: caller.thread.worktreePath,
          recentTurns,
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
        return renderTurnDetails(
          target.thread.id,
          turns.slice(start, end).map(toTurnDetail),
          start,
        );
      }),
    find_threads: (input) =>
      Effect.gen(function* () {
        // Search needs only the caller's id and project, so its shell is enough.
        const scope = yield* requireThreadHistory;
        const caller = yield* threadShell(scope.threadId);
        if (caller === null) return yield* new ThreadNotFoundError({ threadId: scope.threadId });
        const { level } = yield* accessFor(caller.projectId);
        if (!canSearchThreads(level)) {
          return yield* new ThreadSearchOutOfScopeError({ level });
        }
        const { matches } = yield* threadSearch
          .search({ query: input.query, limit: SEARCH_MATCH_LIMIT })
          .pipe(Effect.mapError(readFailed));
        const limit = Math.min(input.limit ?? FIND_THREADS_MAX_LIMIT, FIND_THREADS_MAX_LIMIT);
        const seen = new Set<ThreadId>();
        const projectTitles = new Map<ProjectId, OrchestrationProjectShell | null>();
        const results = [];
        for (const found of matches) {
          if (results.length >= limit) break;
          // The caller is already in its own context, so it is never a result.
          if (found.threadId === caller.id || seen.has(found.threadId)) continue;
          seen.add(found.threadId);
          // Search lists only what the level covers; referenced threads are read directly.
          const inScope = canReadThread({
            callerThreadId: caller.id,
            callerProjectId: caller.projectId,
            targetThreadId: found.threadId,
            targetProjectId: found.projectId,
            level,
            referencedThreadIds: new Set(),
          });
          if (!inScope) continue;
          const shell = yield* threadShell(found.threadId);
          if (shell !== null) results.push(yield* matchOf(shell, projectTitles));
        }
        return renderThreadMatches(results);
      }),
  });
});

export const ThreadHistoryToolkitHandlersLive = ThreadHistoryToolkit.toLayer(make);
