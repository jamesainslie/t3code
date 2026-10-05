/**
 * Fork MCP capabilities granted per thread: the thread history tools follow the
 * project's "Agent thread history" setting. Upstream's session manager grants
 * the rest and adds these through one call.
 */
import type { ServerSettings, ThreadId } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";

import type { McpCapability } from "../../mcp/McpInvocationContext.ts";

const FORK_CAPABILITIES: ReadonlyArray<McpCapability> = ["thread-history", "thread-search"];

/** Reading other threads needs any level above off; searching needs project or environment. */
function threadHistoryCapabilities(
  settings: ServerSettings,
  projectId: Parameters<typeof resolveProjectSettings>[1],
): ReadonlyArray<McpCapability> {
  const level = resolveProjectSettings(settings, projectId).settings.agentThreadHistoryAccess;
  if (level === "off") return [];
  return level === "project" || level === "environment"
    ? ["thread-history", "thread-search"]
    : ["thread-history"];
}

/**
 * The fork capabilities for a thread. An unreadable setting or thread grants none: an explicit
 * "off" must never become "on", and missing tools are visible to the agent at once.
 */
export const forkAgentCapabilities = <SettingsError, ThreadError>(input: {
  readonly threadId: ThreadId;
  readonly getSettings: Effect.Effect<ServerSettings, SettingsError>;
  readonly getProjectId: (
    threadId: ThreadId,
  ) => Effect.Effect<Parameters<typeof resolveProjectSettings>[1], ThreadError>;
}) =>
  Effect.all([input.getSettings, input.getProjectId(input.threadId)]).pipe(
    Effect.map(([settings, projectId]) => threadHistoryCapabilities(settings, projectId)),
    Effect.orElseSucceed((): ReadonlyArray<McpCapability> => []),
  );

/** Whether a credential's fork capabilities still match what the thread should get. */
export const sameForkCapabilities = (
  granted: ReadonlySet<McpCapability>,
  wanted: ReadonlyArray<McpCapability>,
) =>
  FORK_CAPABILITIES.every((capability) => granted.has(capability) === wanted.includes(capability));
