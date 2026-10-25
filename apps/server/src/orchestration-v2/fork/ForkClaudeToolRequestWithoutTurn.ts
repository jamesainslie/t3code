import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

// Claude asks about a tool call only when its own rules want a person to decide,
// even in Full access. With no active turn the request cannot reach the user, so
// it is denied with what to do instead: agents retried the bare denial unchanged.
const NO_TURN = "This thread has no active turn, so the request cannot reach the user.";

const NO_RETRY = "Do not retry the same call.";

export function claudeToolRequestWithoutTurn(
  toolName: string,
  toolUseID: string,
): PermissionResult {
  return { behavior: "deny", message: messageFor(toolName), toolUseID };
}

function messageFor(toolName: string): string {
  if (toolName === "AskUserQuestion") {
    return [
      "Nobody can answer this question now.",
      NO_TURN,
      "Choose the safest reasonable option and name it in your final report,",
      "or end with the question so the user sees it.",
    ].join(" ");
  }
  if (toolName === "Bash") {
    return [
      "Nobody can approve this command now.",
      NO_TURN,
      "Claude asks for approval when it cannot check a command, for example a write",
      "inside a `bash -c '...'` wrapper or `rm -rf` on a glob.",
      NO_RETRY,
      "Run the command directly without a wrapper, make file changes with the Edit",
      "or Write tools, or finish and report the step that is left.",
    ].join(" ");
  }
  return [
    "Nobody can approve this tool call now.",
    NO_TURN,
    NO_RETRY,
    "Use a tool or command that needs no approval, or finish and report the step that is left.",
  ].join(" ");
}
