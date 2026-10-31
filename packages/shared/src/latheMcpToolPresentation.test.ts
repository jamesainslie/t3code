import { describe, expect, it } from "vite-plus/test";

import {
  LATHE_MCP_TOOL_NAMES,
  resolveLatheMcpSummaryAction,
  resolveLatheMcpToolDefinition,
  resolveLatheMcpToolPresentation,
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
    expect(resolveLatheMcpToolDefinition("lathe_roadmap_log_hours")?.summaryAction).toBe(
      "roadmap-log-hours",
    );
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_roadmap_add_note")).toEqual({
      displayName: "Add a progress note to a work item",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolDefinition("lathe_roadmap_add_note")?.summaryAction).toBe(
      "roadmap-update",
    );
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_roadmap_import_issue")).toEqual({
      displayName: "Import a GitHub issue to the roadmap",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolDefinition("lathe_roadmap_import_issue")?.summaryAction).toBe(
      "roadmap-create",
    );
    expect(resolveLatheMcpToolPresentation("mcp__lathe__lathe_roadmap_link_pull_request")).toEqual({
      displayName: "Link a pull request to a work item",
      logo: "lathe",
    });
    expect(resolveLatheMcpToolDefinition("lathe_roadmap_link_pull_request")?.summaryAction).toBe(
      "roadmap-update",
    );
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });
});

describe("resolveLatheMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveLatheMcpToolDefinition("mcp__lathe__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveLatheMcpToolDefinition("preview_type")?.labels);
    expect(
      resolveLatheMcpToolDefinition("lathe_thread_transfer", { action: "fork" })?.displayName,
    ).toBe(resolveLatheMcpToolDefinition("lathe_thread_fork")?.displayName);
    expect(resolveLatheMcpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveLatheMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveLatheMcpSummaryAction("mcp__lathe__lathe_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveLatheMcpSummaryAction("lathe_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveLatheMcpSummaryAction("lathe_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveLatheMcpSummaryAction("lathe_thread_configure", {})).toBe("thread-configuration");
    expect(resolveLatheMcpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveLatheMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
