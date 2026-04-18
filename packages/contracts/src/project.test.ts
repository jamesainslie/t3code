import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  ProjectFileChangeEvent,
  ProjectFileEntry,
  ProjectFileMonitorError,
  ProjectFileWatchInput,
  ProjectReadFileError,
  ProjectReadFileInput,
  ProjectReadFileResult,
} from "./project.ts";

describe("ProjectReadFileInput", () => {
  it("accepts a valid payload", () => {
    const decoded = Schema.decodeUnknownSync(ProjectReadFileInput)({
      cwd: "/a",
      relativePath: "README.md",
    });
    expect(decoded.relativePath).toBe("README.md");
    expect(decoded.cwd).toBe("/a");
  });

  it("rejects empty relativePath", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectReadFileInput)({
        cwd: "/a",
        relativePath: "",
      }),
    ).toThrow();
  });

  it("rejects empty cwd", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectReadFileInput)({
        cwd: "",
        relativePath: "README.md",
      }),
    ).toThrow();
  });
});

describe("ProjectReadFileResult", () => {
  it("requires contents, size, mtimeMs", () => {
    const r = Schema.decodeUnknownSync(ProjectReadFileResult)({
      contents: "# x",
      relativePath: "a.md",
      size: 3,
      mtimeMs: 1,
    });
    expect(r.size).toBe(3);
    expect(r.contents).toBe("# x");
    expect(r.relativePath).toBe("a.md");
    expect(r.mtimeMs).toBe(1);
  });

  it("accepts size of zero", () => {
    const r = Schema.decodeUnknownSync(ProjectReadFileResult)({
      contents: "",
      relativePath: "empty.md",
      size: 0,
      mtimeMs: 1,
    });
    expect(r.size).toBe(0);
  });

  it("rejects negative size", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectReadFileResult)({
        contents: "",
        relativePath: "empty.md",
        size: -1,
        mtimeMs: 1,
      }),
    ).toThrow();
  });

  it("rejects non-integer size", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectReadFileResult)({
        contents: "",
        relativePath: "empty.md",
        size: 1.5,
        mtimeMs: 1,
      }),
    ).toThrow();
  });
});

describe("ProjectReadFileError", () => {
  it.each(["NotFound", "TooLarge", "PathOutsideRoot", "NotReadable"] as const)(
    "accepts tag %s",
    (tag) => {
      const err = Schema.decodeUnknownSync(ProjectReadFileError)({
        _tag: tag,
        relativePath: "a.md",
      });
      expect(err._tag).toBe(tag);
      expect(err.relativePath).toBe("a.md");
    },
  );

  it("rejects unknown tag", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectReadFileError)({
        _tag: "Unknown",
        relativePath: "a.md",
      }),
    ).toThrow();
  });
});

describe("ProjectFileEntry", () => {
  it("decodes a complete entry", () => {
    const entry = Schema.decodeUnknownSync(ProjectFileEntry)({
      relativePath: "docs/a.md",
      size: 42,
      mtimeMs: 1700000000000,
      oversized: false,
    });
    expect(entry.relativePath).toBe("docs/a.md");
    expect(entry.size).toBe(42);
    expect(entry.oversized).toBe(false);
  });

  it("rejects empty relativePath", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectFileEntry)({
        relativePath: "",
        size: 0,
        mtimeMs: 0,
        oversized: false,
      }),
    ).toThrow();
  });
});

describe("ProjectFileWatchInput", () => {
  it("requires cwd, globs; ignoreGlobs defaults to empty array", () => {
    const v = Schema.decodeUnknownSync(ProjectFileWatchInput)({
      cwd: "/a",
      globs: ["**/*.md"],
    });
    expect(v.cwd).toBe("/a");
    expect(v.globs).toEqual(["**/*.md"]);
    expect(v.ignoreGlobs).toEqual([]);
  });

  it("accepts explicit ignoreGlobs", () => {
    const v = Schema.decodeUnknownSync(ProjectFileWatchInput)({
      cwd: "/a",
      globs: ["**/*.md"],
      ignoreGlobs: ["node_modules/**"],
    });
    expect(v.ignoreGlobs).toEqual(["node_modules/**"]);
  });

  it("rejects empty cwd", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectFileWatchInput)({
        cwd: "",
        globs: ["**/*.md"],
      }),
    ).toThrow();
  });
});

describe("ProjectFileChangeEvent", () => {
  it.each([
    [
      "snapshot",
      {
        _tag: "snapshot",
        files: [
          { relativePath: "a.md", size: 1, mtimeMs: 1, oversized: false },
        ],
      },
    ],
    ["added", { _tag: "added", relativePath: "a.md", size: 1, mtimeMs: 1 }],
    ["changed", { _tag: "changed", relativePath: "a.md", size: 1, mtimeMs: 1 }],
    ["removed", { _tag: "removed", relativePath: "a.md" }],
    [
      "turnTouchedDoc",
      {
        _tag: "turnTouchedDoc",
        threadId: "t-1",
        turnId: "u-1",
        paths: ["a.md"],
      },
    ],
  ] as const)("accepts %s variant", (_name, payload) => {
    const decoded = Schema.decodeUnknownSync(ProjectFileChangeEvent)(payload);
    expect(decoded._tag).toBe(payload._tag);
  });

  it("rejects an unknown variant", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProjectFileChangeEvent)({
        _tag: "bogus",
        relativePath: "a.md",
      }),
    ).toThrow();
  });
});

describe("ProjectFileMonitorError", () => {
  it.each(["PathOutsideRoot", "MonitorFailed"] as const)(
    "accepts tag %s",
    (tag) => {
      const err = Schema.decodeUnknownSync(ProjectFileMonitorError)({
        _tag: tag,
        detail: "nope",
      });
      expect(err._tag).toBe(tag);
    },
  );
});
