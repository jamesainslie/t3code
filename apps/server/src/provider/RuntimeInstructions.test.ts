import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions, threadHistoryInstructionMode } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("requires explicit registration of every PR and stack layer", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });
    expect(instructions).toContain("When the t3-code MCP server exposes link_pull_request");
    expect(instructions).toContain("with the full PR URL immediately after creating a PR");
    expect(instructions).toContain("For a stack, call it for every layer");
    expect(instructions).toContain("call list_thread_pull_requests and link any PR");
  });

  it("tells the agent to address and resolve the user's document comments", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });
    expect(instructions).toContain("review comments whose section reads `Document comment <id>`");
    expect(instructions).toContain("call resolve_document_comment with that id");
    expect(instructions).toContain("list_document_comments shows the open ones");
  });

  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
  });

  it("names the model by display name and slug when they differ", () => {
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "gpt-5.4", modelName: "GPT-5.4" }),
    ).toContain("through the Codex harness, as GPT-5.4 (model slug: gpt-5.4).");
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "my-model", modelName: "my-model" }),
    ).toContain("through the Codex harness, as my-model.");
  });

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });

  it("omits the thread history block without the capability", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });
    expect(instructions).not.toContain("<thread_history>");
    expect(instructions).not.toContain("read_thread");
  });

  it("includes find_threads in search mode only", () => {
    const read = buildRuntimeInstructions({ harness: "Codex", threadHistory: "read" });
    expect(read).toContain("<thread_history>");
    expect(read).toContain("with read_thread and read_thread_turns. Use them");
    expect(read).not.toContain("find_threads");

    const search = buildRuntimeInstructions({ harness: "Codex", threadHistory: "search" });
    expect(search).toContain("with read_thread, read_thread_turns, and find_threads. Use them");
    expect(search).toContain("Call read_thread before doing anything else.");
  });

  it("contains no em-dash", () => {
    for (const threadHistory of [undefined, "read", "search"] as const) {
      const text = buildRuntimeInstructions({ harness: "Codex", threadHistory });
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe("threadHistoryInstructionMode", () => {
  it("derives the mode from the session capabilities", () => {
    expect(threadHistoryInstructionMode(new Set(["thread-history", "thread-search"]))).toBe(
      "search",
    );
    expect(threadHistoryInstructionMode(new Set(["thread-history", "preview"]))).toBe("read");
    expect(threadHistoryInstructionMode(new Set(["preview", "device"]))).toBeUndefined();
    expect(threadHistoryInstructionMode(undefined)).toBeUndefined();
  });
});
