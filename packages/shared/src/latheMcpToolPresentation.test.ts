import { describe, expect, it } from "vite-plus/test";

import {
  LATHE_MCP_TOOL_NAMES,
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

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(resolveLatheMcpToolPresentation("lathe-thread_opencode2-adapter_not_a_tool")).toBeNull();
  });
});
