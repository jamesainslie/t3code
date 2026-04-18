import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
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
