import { describe, expect, it } from "vitest";
import {
  MERMAID_STREAM_SETTLE_MS,
  resolveMermaidView,
  summarizeMermaidError,
} from "../mermaidCodeBlock.logic";

describe("resolveMermaidView", () => {
  it("shows the diagram when settled, not failed, and preview tab is active", () => {
    expect(resolveMermaidView({ activeTab: "preview", failed: false, isSettled: true })).toBe(
      "diagram",
    );
  });

  it("shows the source when the source tab is active", () => {
    expect(resolveMermaidView({ activeTab: "source", failed: false, isSettled: true })).toBe(
      "source",
    );
  });

  it("shows the source while the streamed source has not settled", () => {
    expect(resolveMermaidView({ activeTab: "preview", failed: false, isSettled: false })).toBe(
      "source",
    );
  });

  it("shows the source when the diagram failed to render", () => {
    expect(resolveMermaidView({ activeTab: "preview", failed: true, isSettled: true })).toBe(
      "source",
    );
  });

  it("never attempts the diagram for a failed, unsettled block", () => {
    expect(resolveMermaidView({ activeTab: "preview", failed: true, isSettled: false })).toBe(
      "source",
    );
  });
});

describe("MERMAID_STREAM_SETTLE_MS", () => {
  it("is a positive quiet-period long enough to outlast token cadence", () => {
    expect(MERMAID_STREAM_SETTLE_MS).toBeGreaterThanOrEqual(200);
    expect(MERMAID_STREAM_SETTLE_MS).toBeLessThanOrEqual(1000);
  });
});

describe("summarizeMermaidError", () => {
  it("returns a trimmed single line", () => {
    expect(summarizeMermaidError("  Parse error on line 2:\nexpected TAGEND  ")).toBe(
      "Parse error on line 2: expected TAGEND",
    );
  });

  it("truncates long messages with an ellipsis", () => {
    const long = "x".repeat(400);
    const summary = summarizeMermaidError(long);
    expect(summary.length).toBeLessThanOrEqual(201);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("falls back to a generic message when empty", () => {
    expect(summarizeMermaidError("   ")).toBe("Diagram failed to render");
  });
});
