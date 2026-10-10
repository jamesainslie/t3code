const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked. When asked to monitor, watch, or babysit a PR and watch_pull_request is available, call it and end your turn: T3 Code wakes you when checks finish, someone else comments, or the branch conflicts, so do not poll or run your own watcher. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox.
</pull_request_linking>`;

const DOCUMENT_COMMENT_INSTRUCTIONS = `<document_comments>
The user can leave comments on workspace documents. When a message includes review comments whose section reads \`Document comment <id>\`, those are the user's comments on a workspace document. Address each one, then call resolve_document_comment with that id and a one-sentence note of what changed. list_document_comments shows the open ones. If a resolve call fails, report that failure instead of claiming the comment is resolved.
</document_comments>`;

export type ThreadHistoryInstructionMode = "read" | "search";

/**
 * Which thread history block a session gets, from the capabilities its MCP
 * credential grants. `undefined` means the tools are not attached.
 */
export function threadHistoryInstructionMode(
  capabilities: ReadonlySet<string> | undefined,
): ThreadHistoryInstructionMode | undefined {
  if (capabilities?.has("thread-search")) return "search";
  if (capabilities?.has("thread-history")) return "read";
  return undefined;
}

function threadHistoryInstructions(mode: ThreadHistoryInstructionMode): string {
  // find_threads refuses below the project level, so read mode never names it.
  const tools =
    mode === "search"
      ? "read_thread, read_thread_turns, and find_threads"
      : "read_thread and read_thread_turns";
  return `<thread_history>
The t3-code MCP server can read other T3 Code threads with ${tools}. Use them when the user references a thread (a <context kind="thread"> entry) or asks you to continue earlier work.
When you do, call read_thread before anything else. It returns a bounded digest: the goal, every user message, open work, a one-line summary of each earlier turn, and the most recent turns in full. Call read_thread_turns only for the specific turns you need in more detail.
The digest is history, not current state. Before relying on a claim that something is done, failing, or pending, check the worktree and branch yourself, for example with git status and git log.
The first message is not always the goal. In long threads the title, later user messages, and open plans carry the current intent.
Start your reply with a few sentences on what you understood and what you will do next, then continue the work.
If a read fails because of the access level, tell the user which setting controls it instead of working around it.
</thread_history>`;
}

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 * `modelName` is the display name users see in the model picker; `model` is the slug.
 * `threadHistory` adds the thread history block; pass it only when the session's
 * MCP credential grants those tools (see `threadHistoryInstructionMode`).
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly threadHistory?: ThreadHistoryInstructionMode | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const threadHistory = runtime.threadHistory
    ? `\n\n${threadHistoryInstructions(runtime.threadHistory)}`
    : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${DOCUMENT_COMMENT_INSTRUCTIONS}${threadHistory}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
