import { describe, it, expect } from "vitest";
import type { ProjectFileEntry, ProjectFileChangeEvent } from "@t3tools/contracts";
import { applyFileChangeEvent, type DocsFileState, INITIAL_DOCS_FILE_STATE } from "./docsFileState";

const entry = (path: string, size = 100, oversized = false): ProjectFileEntry =>
  ({
    relativePath: path,
    size,
    mtimeMs: Date.now(),
    oversized,
  }) as ProjectFileEntry;

describe("applyFileChangeEvent", () => {
  it("replaces files on snapshot", () => {
    const state = applyFileChangeEvent(INITIAL_DOCS_FILE_STATE, {
      _tag: "snapshot",
      files: [entry("a.md"), entry("b.md")],
    } as ProjectFileChangeEvent);
    expect(state.files).toHaveLength(2);
    expect(state.isPending).toBe(false);
  });

  it("appends on added", () => {
    const base: DocsFileState = {
      files: [entry("a.md")],
      isPending: false,
    };
    const state = applyFileChangeEvent(base, {
      _tag: "added",
      relativePath: "b.md",
      size: 50,
      mtimeMs: Date.now(),
    } as ProjectFileChangeEvent);
    expect(state.files).toHaveLength(2);
    expect(state.files[1]!.relativePath).toBe("b.md");
  });

  it("updates size on changed", () => {
    const base: DocsFileState = {
      files: [entry("a.md", 100)],
      isPending: false,
    };
    const state = applyFileChangeEvent(base, {
      _tag: "changed",
      relativePath: "a.md",
      size: 200,
      mtimeMs: Date.now(),
    } as ProjectFileChangeEvent);
    expect(state.files[0]!.size).toBe(200);
  });

  it("removes file on removed", () => {
    const base: DocsFileState = {
      files: [entry("a.md"), entry("b.md")],
      isPending: false,
    };
    const state = applyFileChangeEvent(base, {
      _tag: "removed",
      relativePath: "a.md",
    } as ProjectFileChangeEvent);
    expect(state.files).toHaveLength(1);
    expect(state.files[0]!.relativePath).toBe("b.md");
  });

  it("returns same reference for turnTouchedDoc (no-op)", () => {
    const base: DocsFileState = {
      files: [entry("a.md")],
      isPending: false,
    };
    const state = applyFileChangeEvent(base, {
      _tag: "turnTouchedDoc",
      threadId: "t-1",
      turnId: "u-1",
      paths: ["a.md"],
    } as unknown as ProjectFileChangeEvent);
    expect(state).toBe(base);
  });

  it("handles changed for non-existent file gracefully", () => {
    const base: DocsFileState = {
      files: [entry("a.md")],
      isPending: false,
    };
    const state = applyFileChangeEvent(base, {
      _tag: "changed",
      relativePath: "nonexistent.md",
      size: 100,
      mtimeMs: Date.now(),
    } as ProjectFileChangeEvent);
    // Should return a new state but same files (no match found)
    expect(state.files).toHaveLength(1);
    expect(state.files[0]!.relativePath).toBe("a.md");
  });
});
