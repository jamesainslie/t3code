import { describe, expect, it } from "vite-plus/test";

import {
  LATHE_MCP_TOOL_NAMES,
  resolveLatheMcpToolPresentation,
  resolveLatheMcpToolSummaryAction,
} from "./latheMcpToolPresentation.ts";

describe("resolveLatheMcpToolPresentation", () => {
  it("recognizes every Lathe tool across provider prefixes and completion suffixes", () => {
    for (const tool of LATHE_MCP_TOOL_NAMES) {
      const presentation = resolveLatheMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__lathe__",
        "mcp__lathe__",
        "mcp__t3code__",
        "Lathe.",
        "lathe/",
        "t3code:",
        "mcp_lathe_",
        "Lathe ",
        "lathe · ",
      ]) {
        expect(resolveLatheMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveLatheMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor Lathe MCP tool names", () => {
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_thread_read")).toEqual({
      displayName: "Read a Lathe thread",
      logo: "lathe",
    });
  });

  it("pretty prints Codex Lathe MCP tool names", () => {
    expect(resolveLatheMcpToolPresentation("lathe.create_threads")).toEqual({
      displayName: "Create Lathe threads",
      logo: "lathe",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_thread_update")).toEqual({
      displayName: "Update Lathe thread metadata",
      logo: "lathe",
    });
  });

  it("pretty prints roadmap tool names", () => {
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_roadmap_criterion_tick")).toEqual({
      displayName: "Tick an acceptance criterion",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolPresentation("lathe.lathe_roadmap_create")).toEqual({
      displayName: "Create a roadmap work item",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_roadmap_log_hours")).toEqual({
      displayName: "Log hours on a work item",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolSummaryAction("lathe_roadmap_log_hours")).toBe("roadmap-log-hours");
  });

  it("pretty prints bare Lathe MCP toolkit names", () => {
    expect(resolveLatheMcpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "lathe",
    });
  });

  it("pretty prints worktree Lathe MCP tool names", () => {
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolPresentation("lathe.lathe_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "lathe",
    });
  });

  it("pretty prints preview Lathe MCP tool names", () => {
    expect(resolveLatheMcpToolPresentation("Lathe.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolPresentation("mcp__lathe__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "lathe",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_lathe_delegate_task",
      "lathe:delegate_task",
      "t3code/delegate_task",
      "lathe delegate_task",
      "Lathe delegate_task",
      "lathe__delegate_task",
    ]) {
      expect(resolveLatheMcpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveLatheMcpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveLatheMcpToolPresentation("lathe.not_a_real_tool")).toBeNull();
  });
});
