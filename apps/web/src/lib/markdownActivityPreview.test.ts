import { describe, expect, it } from "vitest";

import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  collectMarkdownActivityPreviewPaths,
  findMarkdownActivityPreviewSignal,
  normalizeMarkdownPreviewPath,
} from "./markdownActivityPreview";

function makeActivity(overrides: {
  id: string;
  turnId?: string;
  payload: Record<string, unknown>;
  kind?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id),
    tone: "tool",
    kind: overrides.kind ?? "tool.completed",
    summary: "File change",
    payload: overrides.payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    createdAt: "2026-04-20T21:00:00.000Z",
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("normalizeMarkdownPreviewPath", () => {
  it("converts absolute markdown paths under the cwd to safe relative paths", () => {
    expect(
      normalizeMarkdownPreviewPath("/Volumes/Code/titan/scratch/sample.md", "/Volumes/Code/titan"),
    ).toBe("scratch/sample.md");
  });

  it("keeps safe relative markdown paths and rejects non-markdown or escaping paths", () => {
    expect(normalizeMarkdownPreviewPath("docs/PLAN.markdown", "/repo")).toBe("docs/PLAN.markdown");
    expect(normalizeMarkdownPreviewPath("src/app.ts", "/repo")).toBeNull();
    expect(normalizeMarkdownPreviewPath("../outside.md", "/repo")).toBeNull();
    expect(normalizeMarkdownPreviewPath("/tmp/outside.md", "/repo")).toBeNull();
  });
});

describe("findMarkdownActivityPreviewSignal", () => {
  it("returns the newest markdown file-change signal from the active turn", () => {
    const signal = findMarkdownActivityPreviewSignal({
      cwd: "/Volumes/Code/titan",
      turnId: TurnId.make("turn-active"),
      activities: [
        makeActivity({
          id: "older",
          turnId: "turn-active",
          sequence: 1,
          payload: {
            data: {
              file_path: "/Volumes/Code/titan/scratch/older.md",
            },
          },
        }),
        makeActivity({
          id: "newer",
          turnId: "turn-active",
          sequence: 2,
          payload: {
            data: {
              item: {
                filePath: "/Volumes/Code/titan/scratch/sample.md",
              },
            },
          },
        }),
      ],
    });

    expect(signal).toEqual({
      key: "turn-active:newer:scratch/sample.md",
      paths: ["scratch/sample.md"],
    });
  });

  it("ignores file changes from older turns", () => {
    const signal = findMarkdownActivityPreviewSignal({
      cwd: "/repo",
      turnId: TurnId.make("turn-active"),
      activities: [
        makeActivity({
          id: "older-turn-write",
          turnId: "turn-older",
          payload: {
            data: {
              filePath: "/repo/docs/old.md",
            },
          },
        }),
      ],
    });

    expect(signal).toBeNull();
  });
});

describe("collectMarkdownActivityPreviewPaths", () => {
  it("collects unique markdown paths mentioned across thread activities in activity order", () => {
    const paths = collectMarkdownActivityPreviewPaths({
      cwd: "/Volumes/Code/titan",
      activities: [
        makeActivity({
          id: "first",
          turnId: "turn-one",
          sequence: 1,
          payload: {
            data: {
              filePath: "/Volumes/Code/titan/scratch/test.md",
            },
          },
        }),
        makeActivity({
          id: "second",
          turnId: "turn-two",
          sequence: 2,
          payload: {
            data: {
              files: [
                { path: "/Volumes/Code/titan/scratch/sample.md" },
                { path: "/Volumes/Code/titan/scratch/test.md" },
              ],
            },
          },
        }),
      ],
    });

    expect(paths).toEqual(["scratch/test.md", "scratch/sample.md"]);
  });
});
