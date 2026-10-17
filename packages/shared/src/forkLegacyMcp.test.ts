import { describe, expect, it } from "vite-plus/test";

import { latheMcpToolLabel } from "./forkLegacyMcp.ts";
import { resolveLatheMcpToolPresentation } from "./latheMcpToolPresentation.ts";

describe("latheMcpToolLabel", () => {
  it.each([
    ["t3_thread_send", "lathe_thread_send"],
    ["mcp__t3-code__t3_project_clone", "mcp__t3-code__lathe_project_clone"],
    ["t3_code.t3_thread_send", "t3_code.lathe_thread_send"],
    ["delegate_task", "delegate_task"],
    ["mcp__other__t3_thread_send_x", "mcp__other__lathe_thread_send_x"],
  ])("reads %s as %s", (label, expected) => {
    expect(latheMcpToolLabel(label)).toBe(expected);
  });
});

describe("tool calls stored before the Lathe rename", () => {
  it.each([
    "mcp__t3-code__t3_thread_read",
    "mcp__t3_code__t3_project_clone",
    "t3_code.t3_thread_send",
    "T3-code.t3_project_list",
    "t3-code · preview_click",
    "t3_thread_send",
  ])("still present %s as a Lathe tool", (toolName) => {
    expect(resolveLatheMcpToolPresentation(toolName)?.logo).toBe("lathe");
  });
});
