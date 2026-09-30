import {
  AgentThreadHistoryAccess,
  AGENT_THREAD_HISTORY_RECENT_TURNS_MAX,
  OrchestrationSearchThreadsInput,
  PositiveInt,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ServerSettings from "../../../serverSettings.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ServerSettings.ServerSettingsService,
];

export const READ_THREAD_TURNS_DEFAULT_LIMIT = 5;
export const READ_THREAD_TURNS_MAX_LIMIT = 10;
export const FIND_THREADS_MAX_LIMIT = 20;

const ACCESS_LABELS: Record<AgentThreadHistoryAccess, string> = {
  off: "Off",
  referenced: "Referenced threads",
  project: "This project",
  environment: "All projects",
};

export class ThreadNotFoundError extends Schema.TaggedError<ThreadNotFoundError>()(
  "ThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found in this T3 Code environment.`;
  }
}

export class ThreadOutOfScopeError extends Schema.TaggedError<ThreadOutOfScopeError>()(
  "ThreadOutOfScopeError",
  { threadId: Schema.String, level: AgentThreadHistoryAccess },
) {
  override get message(): string {
    // Referencing a thread grants nothing while history is off, so do not suggest it.
    if (this.level === "off") {
      return `Thread history is off for this thread's project. Ask the user to turn on "Agent thread history" in Settings.`;
    }
    return `Thread ${this.threadId} is outside what this thread may read (thread history access: ${ACCESS_LABELS[this.level]}). Ask the user to reference the thread in a message, or to raise "Agent thread history" in Settings.`;
  }
}

/** The session's credential lacks the thread-history capability, granted only at session start. */
export class ThreadHistoryOffError extends Schema.TaggedError<ThreadHistoryOffError>()(
  "ThreadHistoryOffError",
  {},
) {
  override get message(): string {
    return `Thread history is off for this thread. Ask the user to turn on "Agent thread history" in Settings; it applies from the thread's next session.`;
  }
}

/** `find_threads` lists threads the user never pointed at, so it has its own refusal. */
export class ThreadSearchOutOfScopeError extends Schema.TaggedError<ThreadSearchOutOfScopeError>()(
  "ThreadSearchOutOfScopeError",
  { level: AgentThreadHistoryAccess },
) {
  override get message(): string {
    return `Searching threads is not allowed at this thread's history access level (${ACCESS_LABELS[this.level]}). Ask the user to raise "Agent thread history" in Settings to This project or All projects.`;
  }
}

export class InvalidTurnRangeError extends Schema.TaggedError<InvalidTurnRangeError>()(
  "InvalidTurnRangeError",
  { beforeTurn: Schema.Number, turnCount: Schema.Number },
) {
  override get message(): string {
    if (this.turnCount === 0) return "This thread has no turns yet.";
    return `beforeTurn must be between 2 and ${this.turnCount + 1}.`;
  }
}

export class ThreadHistoryReadFailedError extends Schema.TaggedError<ThreadHistoryReadFailedError>()(
  "ThreadHistoryReadFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read thread history.";
  }
}

export const ThreadHistoryToolError = Schema.Union([
  ThreadHistoryOffError,
  ThreadNotFoundError,
  ThreadOutOfScopeError,
  ThreadSearchOutOfScopeError,
  InvalidTurnRangeError,
  ThreadHistoryReadFailedError,
]);
export type ThreadHistoryToolError = typeof ThreadHistoryToolError.Type;

const ThreadIdInput = TrimmedNonEmptyString.annotate({
  description:
    'Id of the thread to read, for example from a <context kind="thread"> entry or a find_threads result.',
});

const ReadThreadTool = Tool.make("read_thread", {
  description:
    "Call this first to pick up another T3 Code thread's work. Returns a bounded summary as tagged text: the thread's goal, the user's later steering, open work (todos, plans, comments, pull requests), one-line outcomes of earlier turns, and the most recent turns in detail. Turns are numbered; read_thread_turns returns earlier turns in full, and find_threads locates a thread you have no id for.",
  parameters: Schema.Struct({
    threadId: ThreadIdInput,
    recentTurns: Schema.optional(
      Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: AGENT_THREAD_HISTORY_RECENT_TURNS_MAX }),
      ).annotate({
        description:
          "How many of the latest turns to include in detail. Defaults to, and is capped by, the user's setting.",
      }),
    ),
  }),
  success: Schema.String,
  failure: ThreadHistoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ReadThreadTurnsTool = Tool.make("read_thread_turns", {
  description:
    "Returns turns of another T3 Code thread in full, oldest first, ending just before beforeTurn. Use it after read_thread when a summarized earlier turn matters; the result ends with the beforeTurn to pass for the page before it. Omit beforeTurn for the latest turns.",
  parameters: Schema.Struct({
    threadId: ThreadIdInput,
    beforeTurn: Schema.optional(
      PositiveInt.annotate({
        description:
          "Turn number to read up to, exclusive, as shown by read_thread or a previous page. Omit it for the latest turns.",
      }),
    ),
    limit: Schema.optional(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: READ_THREAD_TURNS_MAX_LIMIT }),
      ).annotate({
        description: `How many turns to return. Defaults to ${READ_THREAD_TURNS_DEFAULT_LIMIT}.`,
      }),
    ),
  }),
  success: Schema.String,
  failure: ThreadHistoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Read thread turns")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const FindThreadsTool = Tool.make("find_threads", {
  description:
    "Search the message text of other T3 Code threads (titles are not searched). Returns one line per matching thread with its id, title, project, branch, last activity, and status; pass an id to read_thread to pick up its work. Only available when the user allows thread history for this project or all projects.",
  parameters: Schema.Struct({
    query: OrchestrationSearchThreadsInput.fields.query.annotate({
      description: "Words to look for, 2 to 200 characters.",
    }),
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: FIND_THREADS_MAX_LIMIT })).annotate({
        description: `How many threads to return. Defaults to ${FIND_THREADS_MAX_LIMIT}.`,
      }),
    ),
  }),
  success: Schema.String,
  failure: ThreadHistoryToolError,
  dependencies,
})
  .annotate(Tool.Title, "Find threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const ThreadHistoryToolkit = Toolkit.make(
  ReadThreadTool,
  ReadThreadTurnsTool,
  FindThreadsTool,
);
